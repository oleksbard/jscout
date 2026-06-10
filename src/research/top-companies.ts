import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import type { AutoParseableTextFormat } from 'openai/lib/parser';
import { z } from 'zod';

export const ResearchedCompanySchema = z.object({
  name: z.string().min(1),
  reason: z.string(),
  estSeniorTotalCompEur: z.number().min(0),
  germanyPresence: z.enum(['office', 'remote-eu']),
  ats: z.object({
    vendor: z.enum(['greenhouse', 'lever', 'personio', 'other', 'unknown']),
    slugGuesses: z.array(z.string()),
  }),
});

export const TopCompaniesSchema = z.object({
  companies: z.array(ResearchedCompanySchema),
});

export type ResearchedCompany = z.infer<typeof ResearchedCompanySchema>;
export type TopCompanies = z.infer<typeof TopCompaniesSchema>;

// Minimal structural slice of the OpenAI client so tests can stub it.
export interface ResearchClient {
  parse(args: {
    model: string;
    input: string;
    tools: { type: 'web_search' }[];
    format: AutoParseableTextFormat<TopCompanies>;
  }): Promise<{ output_parsed: TopCompanies | null }>;
}

export function openaiResearchClient(client: OpenAI): ResearchClient {
  return {
    parse: async (args) => {
      const response = await client.responses.parse({
        model: args.model,
        input: args.input,
        tools: args.tools,
        text: { format: args.format },
      });
      return { output_parsed: response.output_parsed };
    },
  };
}

export function buildResearchPrompt(count: number): string {
  return [
    'You research employers for a senior software engineer based in Germany.',
    `List the top ${count} technology companies (big tech, scale-ups, fintech/trading included) by realistic TOTAL compensation (base + bonus + equity) for senior/staff software engineers, that either:`,
    '(a) have an engineering office in Germany, or',
    '(b) are established companies that hire engineers fully remote from Germany under an EU-remote policy.',
    'Use web search to ground the list in current data: levels.fyi, Glassdoor/Kununu, recent salary reports and news. Rank by estimated senior-engineer total comp in EUR, highest first.',
    '',
    'For each company report:',
    '- name: official company name.',
    '- reason: ONE sentence on why it pays top of market.',
    '- estSeniorTotalCompEur: estimated annual senior-engineer total comp in EUR.',
    "- germanyPresence: 'office' (engineering office in Germany) or 'remote-eu' (hires remote from Germany).",
    "- ats: which applicant tracking system its careers page uses — vendor 'greenhouse' (job-boards.greenhouse.io/{slug}), 'lever' (jobs.lever.co/{slug}) or 'personio' ({slug}.jobs.personio.de); 'other' or 'unknown' otherwise. slugGuesses: likely board slugs, most likely first (lowercase, no spaces).",
  ].join('\n');
}

export async function researchTopCompanies(
  client: ResearchClient,
  model: string,
  count: number,
): Promise<ResearchedCompany[]> {
  const response = await client.parse({
    model,
    input: buildResearchPrompt(count),
    tools: [{ type: 'web_search' }],
    format: zodTextFormat(TopCompaniesSchema, 'top_companies'),
  });
  const parsed = response.output_parsed;
  if (!parsed || parsed.companies.length === 0) {
    throw new Error('research: no companies returned');
  }
  return parsed.companies;
}
