/**
 * Unit Tests — community submission validation
 *
 * validateShopProposal / parseShopId are the only gate between an anonymous
 * request body and the moderation queue, so every field gets a type, length
 * and vocabulary bound.
 */

const enums = require('../../../src/enums');
const { ValidationError } = require('../../../src/usecases/errors');
const {
    parseShopId,
    validateShopProposal,
    makeSubmitShopProposalUseCase,
} = require('../../../src/usecases/submissions');

function body(overrides = {}, displayName = { text: 'Corner Roasters' }) {
    return {
        shop: {
            displayName,
            formattedAddress: '10 Market St, San Francisco, California 94105',
            state: 'CA',
            ...overrides,
        },
    };
}

function expectInvalid(input, pattern) {
    let caught;
    try {
        validateShopProposal(input, enums);
    } catch (err) {
        caught = err;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    if (pattern) expect(caught.message).toMatch(pattern);
}

describe('validateShopProposal', () => {
    it('normalises a minimal valid proposal', () => {
        expect(validateShopProposal(body(), enums)).toEqual({
            name: 'Corner Roasters',
            address: '10 Market St, San Francisco, California 94105',
            state: 'CA',
            priceLevel: null,
            phoneNumber: null,
            website: null,
            description: null,
            languageCode: 'en',
        });
    });

    it('accepts every field at its maximum length', () => {
        const result = validateShopProposal(body({
            formattedAddress: 'a'.repeat(300),
            phoneNumber: '+1 (415) 555-0100'.padEnd(32, '0'),
            website: `https://example.com/${'p'.repeat(280)}`,
            description: 'd'.repeat(1000),
            priceLevel: 'PRICE_LEVEL_EXPENSIVE',
        }, { text: 'n'.repeat(200), languageCode: 'en-US' }), enums);
        expect(result.name).toHaveLength(200);
        expect(result.address).toHaveLength(300);
        expect(result.description).toHaveLength(1000);
        expect(result.languageCode).toBe('en-US');
    });

    it('upper-cases a lower-case state code', () => {
        expect(validateShopProposal(body({ state: 'ca' }), enums).state).toBe('CA');
    });

    it.each([
        ['null body', null],
        ['array body', []],
        ['string body', 'shop'],
        ['missing shop', {}],
        ['array shop', { shop: [] }],
        ['string shop', { shop: 'x' }],
    ])('rejects %s', (_label, input) => {
        expectInvalid(input);
    });

    describe('length bounds', () => {
        it.each([
            ['name', body({}, { text: 'n'.repeat(201) }), /displayName\.text/],
            ['address', body({ formattedAddress: 'a'.repeat(301) }), /formattedAddress/],
            ['phoneNumber', body({ phoneNumber: '1'.repeat(33) }), /phoneNumber/],
            ['website', body({ website: `https://example.com/${'p'.repeat(290)}` }), /website/],
            ['description', body({ description: 'd'.repeat(1001) }), /description/],
            ['languageCode', body({}, { text: 'ok', languageCode: 'x'.repeat(17) }), /languageCode/],
        ])('rejects an over-long %s', (_field, input, pattern) => {
            expectInvalid(input, pattern);
        });

        it('rejects a whitespace-only name', () => {
            expectInvalid(body({}, { text: '   ' }), /displayName\.text/);
        });
    });

    describe('types', () => {
        it.each([
            ['numeric name', body({}, { text: 42 })],
            ['object name', body({}, { text: { $gt: '' } })],
            ['array displayName', body({}, ['Corner'])],
            ['numeric address', body({ formattedAddress: 12345 })],
            ['array address', body({ formattedAddress: ['a', 'b'] })],
            ['numeric state', body({ state: 6 })],
            ['numeric priceLevel', body({ priceLevel: 2 })],
            ['object phoneNumber', body({ phoneNumber: { n: 1 } })],
            ['boolean website', body({ website: true })],
            ['array description', body({ description: ['x'] })],
            ['numeric languageCode', body({}, { text: 'ok', languageCode: 1 })],
        ])('rejects %s', (_label, input) => {
            expectInvalid(input);
        });
    });

    describe('vocabularies and formats', () => {
        it.each([['XX'], ['C'], ['CAL'], ['']])('rejects state %p', (state) => {
            expectInvalid(body({ state }), /state/);
        });

        it.each([['PRICE_LEVEL_FREE'], ['moderate'], ['PRICE_LEVEL_MODERATE ']])('rejects priceLevel %p', (priceLevel) => {
            expectInvalid(body({ priceLevel }), /priceLevel/);
        });

        it.each([
            ['javascript:alert(1)'],
            ['data:text/html,hi'],
            ['ftp://example.com'],
            ['not a url'],
            ['https://user:pass@example.com'],
        ])('rejects website %p', (website) => {
            expectInvalid(body({ website }), /website/);
        });

        it.each([['call me'], ['555-0100; DROP TABLE'], ['<script>']])('rejects phoneNumber %p', (phoneNumber) => {
            expectInvalid(body({ phoneNumber }), /phoneNumber/);
        });

        it.each([['english'], ['e'], ['en_US'], ['../..']])('rejects languageCode %p', (languageCode) => {
            expectInvalid(body({}, { text: 'ok', languageCode }), /languageCode/);
        });

        it('rejects control characters in free text', () => {
            expectInvalid(body({}, { text: 'Corner\u0000Roasters' }), /displayName\.text/);
            expectInvalid(body({ description: 'line\u0007bell' }), /description/);
        });

        it('allows newlines and tabs in the description', () => {
            const result = validateShopProposal(body({ description: 'Line one\n\tLine two' }), enums);
            expect(result.description).toBe('Line one\n\tLine two');
        });

        it('accepts http and https websites', () => {
            expect(validateShopProposal(body({ website: 'http://corner.example' }), enums).website).toBe('http://corner.example');
            expect(validateShopProposal(body({ website: 'https://corner.example/menu?x=1' }), enums).website).toBe('https://corner.example/menu?x=1');
        });
    });
});

describe('parseShopId', () => {
    it.each([['1', 1], ['42', 42], ['9999999999', 9999999999]])('accepts %p', (raw, expected) => {
        expect(parseShopId(raw)).toBe(expected);
    });

    it.each([['0'], ['-1'], ['01'], ['12abc'], ['1.5'], ['1e3'], [' 1'], ['99999999999'], [''], [undefined]])(
        'rejects %p',
        (raw) => {
            expect(() => parseShopId(raw)).toThrow(ValidationError);
        },
    );
});

describe('makeSubmitShopProposalUseCase', () => {
    const proposal = validateShopProposal(body(), enums);

    it('passes the queue cap into the single capacity-checked INSERT', async () => {
        const db = { get: jest.fn(), run: jest.fn().mockResolvedValue({ lastID: 7, changes: 1 }) };
        const submit = makeSubmitShopProposalUseCase({ db, queueMax: 3, now: () => 1000 });

        await expect(submit({ kind: 'create', targetShopId: null, proposal })).resolves.toEqual({ submissionId: 7 });

        const [sql, params] = db.run.mock.calls[0];
        expect(sql).toMatch(/INSERT INTO shop_submissions/);
        expect(sql).not.toMatch(/coffee_shops/);
        expect(params[params.length - 1]).toBe(3);
        expect(params[params.length - 2]).toBe(1000);
        expect(db.get).not.toHaveBeenCalled();
    });

    it('raises SUBMISSION_QUEUE_FULL when the capacity-checked INSERT stores nothing', async () => {
        const db = { get: jest.fn(), run: jest.fn().mockResolvedValue({ lastID: 0, changes: 0 }) };
        const submit = makeSubmitShopProposalUseCase({ db, queueMax: 0 });

        await expect(submit({ kind: 'create', targetShopId: null, proposal }))
            .rejects.toMatchObject({ name: 'UnavailableError', code: 'SUBMISSION_QUEUE_FULL' });
    });

    it('update proposals check the target exists and never write coffee_shops', async () => {
        const db = { get: jest.fn().mockResolvedValue(undefined), run: jest.fn() };
        const submit = makeSubmitShopProposalUseCase({ db, queueMax: 10 });

        await expect(submit({ kind: 'update', targetShopId: 5, proposal })).rejects.toBeInstanceOf(ValidationError);
        expect(db.get.mock.calls[0][0]).toMatch(/^SELECT id FROM coffee_shops WHERE id = \?$/);
        expect(db.run).not.toHaveBeenCalled();
    });
});
