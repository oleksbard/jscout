import { describe, expect, it } from 'vitest';
import fixture from '../../fixtures/hn-comments.json';
import { normalizeHnComments } from './hn-whoishiring';

describe('normalizeHnComments', () => {
  it('parses pipe-separated headline into company/title/location', () => {
    const jobs = normalizeHnComments(fixture);
    expect(jobs).toHaveLength(1); // short reply comment dropped
    expect(jobs[0]).toMatchObject({
      id: 'hn:40000001',
      source: 'hn',
      title: 'Senior Frontend Engineer',
      company: 'Delta Systems',
      location: 'Berlin or Remote (EU)',
      workMode: 'remote',
      url: 'https://news.ycombinator.com/item?id=40000001',
    });
  });

  it('does not mark negated remote as remote', () => {
    const jobs = normalizeHnComments({
      hits: [
        {
          objectID: '40000003',
          comment_text:
            'Epsilon AG | Senior React Developer | Berlin | Full-time. Onsite role, no remote. We build a large TypeScript platform with React and Node for European logistics companies.',
          created_at: '2026-06-02T11:00:00.000Z',
        },
      ],
    });
    expect(jobs[0]?.workMode).toBe('unknown');
  });
});
