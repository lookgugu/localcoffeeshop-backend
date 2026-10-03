/**
 * Integration Tests — Prisma / PostGIS schema
 *
 * Runs against a real PostgreSQL + PostGIS database with prisma/migrations
 * applied. Skipped unless PRISMA_TEST_DATABASE_URL is set, so the default
 * SQLite-only test run is unaffected. Data is written and cleaned up per test,
 * so point it at a disposable database:
 *
 *   PRISMA_TEST_DATABASE_URL=postgresql://... npx prisma migrate deploy
 *   PRISMA_TEST_DATABASE_URL=postgresql://... npm test -- prisma-schema
 */

const url = process.env.PRISMA_TEST_DATABASE_URL;
const describeIfPg = url ? describe : describe.skip;

describeIfPg('Prisma schema — PostgreSQL + PostGIS', () => {
    let prisma;

    const cafeData = (slug, overrides = {}) => ({
        slug,
        name: `Test ${slug}`,
        streetAddress: '1 Test St',
        city: 'Portland',
        stateCode: 'OR',
        postalCode: '97201',
        latitude: 45.5152,
        longitude: -122.6784,
        ...overrides,
    });

    beforeAll(() => {
        const { PrismaClient } = require('@prisma/client');
        prisma = new PrismaClient({ datasourceUrl: url });
    });

    afterEach(async () => {
        await prisma.cafe.deleteMany({ where: { slug: { startsWith: 'test-' } } });
        await prisma.roaster.deleteMany({ where: { slug: { startsWith: 'test-' } } });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it('creates a cafe with nested coffee program, workspace profile, hours and roasters', async () => {
        const cafe = await prisma.cafe.create({
            data: {
                ...cafeData('test-nested'),
                roasterType: 'HYBRID',
                coffeeProgram: {
                    create: {
                        brewMethods: ['POUR_OVER_V60', 'ESPRESSO_MANUAL'],
                        roastProfiles: ['LIGHT_NORDIC'],
                        decafProcesses: ['SWISS_WATER'],
                        plantMilksOffered: ['Oatly', 'Minor Figures'],
                        hasAltMilkUpcharge: true,
                        altMilkUpchargeCents: 75,
                        espressoMachine: 'La Marzocco Linea PB',
                    },
                },
                workspaceProfile: { create: { laptopPolicy: 'WEEKDAYS_ONLY', powerOutlets: 'ABUNDANT' } },
                operatingHours: { create: [{ dayOfWeek: 1, openTime: '07:00', closeTime: '17:00' }] },
                roasters: {
                    create: [{
                        role: 'PRIMARY_HOUSE',
                        roaster: { create: { slug: 'test-roaster', name: 'Test Roaster', originCity: 'Portland', originState: 'OR' } },
                    }],
                },
            },
            include: { coffeeProgram: true, workspaceProfile: true, operatingHours: true, roasters: true },
        });

        expect(cafe.coffeeProgram.brewMethods).toEqual(['POUR_OVER_V60', 'ESPRESSO_MANUAL']);
        expect(cafe.workspaceProfile.noiseLevel).toBe('MODERATE_BUZZ');
        expect(cafe.operatingHours).toHaveLength(1);
        expect(cafe.roasters[0].role).toBe('PRIMARY_HOUSE');

        const multiRoasterPourOver = await prisma.cafe.findMany({
            where: {
                slug: 'test-nested',
                coffeeProgram: { brewMethods: { hasSome: ['POUR_OVER_V60', 'POUR_OVER_KALITA'] } },
            },
        });
        expect(multiRoasterPourOver).toHaveLength(1);
    });

    it('trigger derives coordinates from latitude/longitude on insert and update', async () => {
        const cafe = await prisma.cafe.create({ data: cafeData('test-geo') });

        const point = async () => (await prisma.$queryRaw`
            SELECT ST_X("coordinates") AS lng, ST_Y("coordinates") AS lat, ST_SRID("coordinates") AS srid
            FROM "Cafe" WHERE id = ${cafe.id}`)[0];

        expect(await point()).toEqual({ lng: -122.6784, lat: 45.5152, srid: 4326 });

        await prisma.cafe.update({ where: { id: cafe.id }, data: { latitude: 45.52, longitude: -122.68 } });
        expect(await point()).toEqual({ lng: -122.68, lat: 45.52, srid: 4326 });
    });

    it('finds cafes within a radius using the geometry column', async () => {
        await prisma.cafe.create({ data: cafeData('test-near') });
        await prisma.cafe.create({ data: cafeData('test-far', { city: 'Seattle', stateCode: 'WA', latitude: 47.6062, longitude: -122.3321 }) });

        // 5 miles around downtown Portland
        const rows = await prisma.$queryRaw`
            SELECT slug FROM "Cafe"
            WHERE slug LIKE 'test-%'
              AND ST_DWithin("coordinates"::geography, ST_SetSRID(ST_MakePoint(-122.68, 45.52), 4326)::geography, 8047)`;
        expect(rows.map((r) => r.slug)).toEqual(['test-near']);
    });

    it('rejects out-of-range values via CHECK constraints', async () => {
        await expect(prisma.cafe.create({ data: cafeData('test-badlat', { latitude: 91 }) })).rejects.toThrow(/Cafe_latitude_range/);

        const cafe = await prisma.cafe.create({ data: cafeData('test-hours') });
        await expect(prisma.operatingHour.create({
            data: { cafeId: cafe.id, dayOfWeek: 7, openTime: '07:00', closeTime: '17:00' },
        })).rejects.toThrow(/OperatingHour_dayOfWeek_range/);
        await expect(prisma.operatingHour.create({
            data: { cafeId: cafe.id, dayOfWeek: 1, openTime: '7am', closeTime: '17:00' },
        })).rejects.toThrow(/OperatingHour_time_format/);
    });

    it('enforces one link per cafe/roaster pair and cascades cafe deletes', async () => {
        const cafe = await prisma.cafe.create({ data: cafeData('test-cascade') });
        const roaster = await prisma.roaster.create({ data: { slug: 'test-r2', name: 'R2', originCity: 'Bend' } });

        await prisma.cafeRoaster.create({ data: { cafeId: cafe.id, roasterId: roaster.id } });
        await expect(prisma.cafeRoaster.create({ data: { cafeId: cafe.id, roasterId: roaster.id } }))
            .rejects.toMatchObject({ code: 'P2002' });

        await prisma.communityCheckIn.create({ data: { cafeId: cafe.id, clientIpHash: 'abc', isLaptopWorkAllowed: true } });
        await prisma.cafe.delete({ where: { id: cafe.id } });

        expect(await prisma.cafeRoaster.count({ where: { cafeId: cafe.id } })).toBe(0);
        expect(await prisma.communityCheckIn.count({ where: { cafeId: cafe.id } })).toBe(0);
        expect(await prisma.roaster.count({ where: { id: roaster.id } })).toBe(1);
    });
});
