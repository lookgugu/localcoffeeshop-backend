-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "PriceLevel" AS ENUM ('INEXPENSIVE', 'MODERATE', 'EXPENSIVE', 'SPECIALTY');

-- CreateEnum
CREATE TYPE "RoasterType" AS ENUM ('IN_HOUSE_ONLY', 'MULTI_ROASTER', 'HYBRID', 'EXCLUSIVE_PARTNER');

-- CreateEnum
CREATE TYPE "RoasterRole" AS ENUM ('PRIMARY_HOUSE', 'FEATURED_GUEST', 'ANCHOR_PARTNER');

-- CreateEnum
CREATE TYPE "BrewMethod" AS ENUM ('BATCH_BREW', 'POUR_OVER_V60', 'POUR_OVER_KALITA', 'POUR_OVER_CHEMEX', 'POUR_OVER_AEROPRESS', 'ESPRESSO_MANUAL', 'ESPRESSO_AUTOMATED', 'COLD_BREW', 'NITRO_COLD_BREW', 'SIPHON');

-- CreateEnum
CREATE TYPE "RoastSpectrum" AS ENUM ('LIGHT_NORDIC', 'MEDIUM_BALANCED', 'DARK_TRADITIONAL');

-- CreateEnum
CREATE TYPE "DecafProcess" AS ENUM ('SWISS_WATER', 'SUGARCANE_EA', 'MOUNTAIN_WATER', 'SUPERCRITICAL_CO2', 'STANDARD_COMMERCIAL');

-- CreateEnum
CREATE TYPE "LaptopPolicy" AS ENUM ('LAPTOP_FRIENDLY', 'WEEKDAYS_ONLY', 'RESTRICTED_ZONES', 'LAPTOP_FREE');

-- CreateEnum
CREATE TYPE "PowerOutletAvailability" AS ENUM ('ABUNDANT', 'MODERATE', 'SCARCE', 'NONE');

-- CreateEnum
CREATE TYPE "NoiseLevel" AS ENUM ('QUIET_STUDY', 'MODERATE_BUZZ', 'LIVELY_HIGH');

-- CreateTable
CREATE TABLE "Cafe" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "phone" TEXT,
    "websiteUrl" TEXT,
    "instagramHandle" TEXT,
    "priceLevel" "PriceLevel" NOT NULL DEFAULT 'MODERATE',
    "roasterType" "RoasterType" NOT NULL DEFAULT 'MULTI_ROASTER',
    "streetAddress" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "stateCode" VARCHAR(2) NOT NULL,
    "postalCode" TEXT NOT NULL,
    "countryCode" VARCHAR(2) NOT NULL DEFAULT 'US',
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "coordinates" geometry(Point, 4326),
    "isClaimed" BOOLEAN NOT NULL DEFAULT false,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cafe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Roaster" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originCity" TEXT NOT NULL,
    "originState" VARCHAR(2),
    "countryCode" VARCHAR(2) NOT NULL DEFAULT 'US',
    "websiteUrl" TEXT,
    "isSpecialty" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Roaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CafeRoaster" (
    "id" TEXT NOT NULL,
    "cafeId" TEXT NOT NULL,
    "roasterId" TEXT NOT NULL,
    "role" "RoasterRole" NOT NULL DEFAULT 'FEATURED_GUEST',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CafeRoaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoffeeProgram" (
    "id" TEXT NOT NULL,
    "cafeId" TEXT NOT NULL,
    "brewMethods" "BrewMethod"[],
    "roastProfiles" "RoastSpectrum"[],
    "decafProcesses" "DecafProcess"[],
    "plantMilksOffered" TEXT[],
    "hasAltMilkUpcharge" BOOLEAN NOT NULL DEFAULT false,
    "altMilkUpchargeCents" INTEGER,
    "espressoMachine" TEXT,
    "grinderSpecs" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoffeeProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceProfile" (
    "id" TEXT NOT NULL,
    "cafeId" TEXT NOT NULL,
    "laptopPolicy" "LaptopPolicy" NOT NULL DEFAULT 'LAPTOP_FRIENDLY',
    "powerOutlets" "PowerOutletAvailability" NOT NULL DEFAULT 'MODERATE',
    "noiseLevel" "NoiseLevel" NOT NULL DEFAULT 'MODERATE_BUZZ',
    "hasWifi" BOOLEAN NOT NULL DEFAULT true,
    "wifiSpeedMbpsDown" DOUBLE PRECISION,
    "wifiSpeedMbpsUp" DOUBLE PRECISION,
    "requiresWifiPass" BOOLEAN NOT NULL DEFAULT false,
    "hasOutdoorPatio" BOOLEAN NOT NULL DEFAULT false,
    "isDogFriendly" BOOLEAN NOT NULL DEFAULT false,
    "hasGenderNeutralBathrooms" BOOLEAN NOT NULL DEFAULT false,
    "hasFullKitchen" BOOLEAN NOT NULL DEFAULT false,
    "hasDedicatedQuietZone" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingHour" (
    "id" TEXT NOT NULL,
    "cafeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OperatingHour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCheckIn" (
    "id" TEXT NOT NULL,
    "cafeId" TEXT NOT NULL,
    "isLaptopWorkAllowed" BOOLEAN,
    "reportedOutlets" "PowerOutletAvailability",
    "beansOnBar" TEXT,
    "testedWifiDownMbps" DOUBLE PRECISION,
    "clientIpHash" TEXT NOT NULL,
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cafe_slug_key" ON "Cafe"("slug");

-- CreateIndex
CREATE INDEX "Cafe_stateCode_city_idx" ON "Cafe"("stateCode", "city");

-- CreateIndex
CREATE INDEX "Cafe_latitude_longitude_idx" ON "Cafe"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Cafe_isVerified_idx" ON "Cafe"("isVerified");

-- CreateIndex
CREATE INDEX "Cafe_coordinates_idx" ON "Cafe" USING GIST ("coordinates");

-- CreateIndex
CREATE UNIQUE INDEX "Roaster_slug_key" ON "Roaster"("slug");

-- CreateIndex
CREATE INDEX "Roaster_originState_idx" ON "Roaster"("originState");

-- CreateIndex
CREATE INDEX "CafeRoaster_cafeId_isActive_idx" ON "CafeRoaster"("cafeId", "isActive");

-- CreateIndex
CREATE INDEX "CafeRoaster_roasterId_idx" ON "CafeRoaster"("roasterId");

-- CreateIndex
CREATE UNIQUE INDEX "CafeRoaster_cafeId_roasterId_key" ON "CafeRoaster"("cafeId", "roasterId");

-- CreateIndex
CREATE UNIQUE INDEX "CoffeeProgram_cafeId_key" ON "CoffeeProgram"("cafeId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceProfile_cafeId_key" ON "WorkspaceProfile"("cafeId");

-- CreateIndex
CREATE INDEX "WorkspaceProfile_laptopPolicy_idx" ON "WorkspaceProfile"("laptopPolicy");

-- CreateIndex
CREATE UNIQUE INDEX "OperatingHour_cafeId_dayOfWeek_key" ON "OperatingHour"("cafeId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "CommunityCheckIn_cafeId_createdAt_idx" ON "CommunityCheckIn"("cafeId", "createdAt");

-- AddForeignKey
ALTER TABLE "CafeRoaster" ADD CONSTRAINT "CafeRoaster_cafeId_fkey" FOREIGN KEY ("cafeId") REFERENCES "Cafe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CafeRoaster" ADD CONSTRAINT "CafeRoaster_roasterId_fkey" FOREIGN KEY ("roasterId") REFERENCES "Roaster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoffeeProgram" ADD CONSTRAINT "CoffeeProgram_cafeId_fkey" FOREIGN KEY ("cafeId") REFERENCES "Cafe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceProfile" ADD CONSTRAINT "WorkspaceProfile_cafeId_fkey" FOREIGN KEY ("cafeId") REFERENCES "Cafe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingHour" ADD CONSTRAINT "OperatingHour_cafeId_fkey" FOREIGN KEY ("cafeId") REFERENCES "Cafe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCheckIn" ADD CONSTRAINT "CommunityCheckIn_cafeId_fkey" FOREIGN KEY ("cafeId") REFERENCES "Cafe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------
-- Hand-written: constructs Prisma cannot express in schema.prisma.
-- Prisma Migrate does not diff triggers, functions, or CHECK
-- constraints, so these do not cause schema drift.
-- ---------------------------------------------------------

-- Keep "coordinates" derived from latitude/longitude so writers (including
-- the Prisma client, which cannot write Unsupported fields) only set the floats.
CREATE FUNCTION "cafe_sync_coordinates"() RETURNS trigger AS $$
BEGIN
    NEW."coordinates" := ST_SetSRID(ST_MakePoint(NEW."longitude", NEW."latitude"), 4326);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Cafe_sync_coordinates"
    BEFORE INSERT OR UPDATE OF "latitude", "longitude" ON "Cafe"
    FOR EACH ROW EXECUTE FUNCTION "cafe_sync_coordinates"();

-- Radius search ("within N miles") runs on geography for meter-accurate
-- distances; the geometry GIST index above cannot serve those predicates.
-- Query as: ST_DWithin("coordinates"::geography, <point>::geography, <meters>)
CREATE INDEX "Cafe_coordinates_geography_idx" ON "Cafe" USING GIST (("coordinates"::geography));

-- Domain checks
ALTER TABLE "Cafe"
    ADD CONSTRAINT "Cafe_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
    ADD CONSTRAINT "Cafe_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180);

ALTER TABLE "OperatingHour"
    ADD CONSTRAINT "OperatingHour_dayOfWeek_range" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
    ADD CONSTRAINT "OperatingHour_time_format" CHECK (
        "openTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND "closeTime" ~ '^([01][0-9]|2[0-4]):[0-5][0-9]$'
    );

ALTER TABLE "CoffeeProgram"
    ADD CONSTRAINT "CoffeeProgram_altMilkUpchargeCents_nonneg" CHECK ("altMilkUpchargeCents" IS NULL OR "altMilkUpchargeCents" >= 0);
