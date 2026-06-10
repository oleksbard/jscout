import { describe, expect, it } from 'vitest';
import {
  buildResearchPrompt, researchTopCompanies, TopCompaniesSchema,
  type ResearchClient, type TopCompanies,
} from './top-companies';

const valid: TopCompanies = {
  companies: [
    {
      name: 'Stripe',
      reason: 'Top-of-market comp for EU-remote seniors.',
      estSeniorTotalCompEur: 210000,
      germanyPresence: 'remote-eu',
      ats: { vendor: 'greenhouse', slugGuesses: ['stripe'] },
    },
  ],
};

function stubClient(output: TopCompanies | null): ResearchClient & { lastArgs?: unknown } {
  const client: ResearchClient & { lastArgs?: unknown } = {
    parse: async (args) => {
      client.lastArgs = args;
      return { output_parsed: output };
    },
  };
  return client;
}

describe('TopCompaniesSchema', () => {
  it('accepts a valid payload', () => {
    expect(TopCompaniesSchema.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown germanyPresence', () => {
    const bad = {
      companies: [{ ...valid.companies[0], germanyPresence: 'mars' }],
    };
    expect(() => TopCompaniesSchema.parse(bad)).toThrow();
  });
});

describe('researchTopCompanies', () => {
  it('passes model, web_search tool, and the count in the prompt', async () => {
    const client = stubClient(valid);
    await researchTopCompanies(client, 'gpt-5', 30);
    const args = client.lastArgs as { model: string; input: string; tools: { type: string }[] };
    expect(args.model).toBe('gpt-5');
    expect(args.tools).toEqual([{ type: 'web_search' }]);
    expect(args.input).toContain('30');
  });

  it('returns the parsed companies', async () => {
    await expect(researchTopCompanies(stubClient(valid), 'gpt-5', 30)).resolves.toEqual(valid.companies);
  });

  it('throws when parsing returned null', async () => {
    await expect(researchTopCompanies(stubClient(null), 'gpt-5', 30)).rejects.toThrow(/no companies/);
  });

  it('throws when the list is empty', async () => {
    await expect(researchTopCompanies(stubClient({ companies: [] }), 'gpt-5', 30)).rejects.toThrow(/no companies/);
  });
});

describe('buildResearchPrompt', () => {
  it('mentions Germany, EU-remote, and the ATS vendors', () => {
    const prompt = buildResearchPrompt(25);
    expect(prompt).toContain('25');
    expect(prompt).toContain('Germany');
    expect(prompt).toContain('greenhouse');
  });
});
