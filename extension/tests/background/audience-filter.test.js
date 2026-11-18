import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isDefiniteNonUsaLocation,
  classifyProspectByIndianCriteria,
  filterProspectsByCriteria,
} from '../../src/background/ai.js';
import { executeToolCall } from '../../src/background/telegram.js';
import * as voyager from '../../src/background/voyager.js';
import * as lists from '../../src/background/lists.js';

describe('Audience Filter — Stage 1 Local Deterministic Pre-Filter', () => {
  it('correctly identifies non-USA locations', () => {
    expect(isDefiniteNonUsaLocation('Bengaluru, Karnataka, India')).toBe(true);
    expect(isDefiniteNonUsaLocation('Mumbai, Maharashtra, India')).toBe(true);
    expect(isDefiniteNonUsaLocation('London, United Kingdom')).toBe(true);
    expect(isDefiniteNonUsaLocation('Toronto, Ontario, Canada')).toBe(true);
    expect(isDefiniteNonUsaLocation('Sydney, New South Wales, Australia')).toBe(true);
    expect(isDefiniteNonUsaLocation('Berlin, Germany')).toBe(true);

    // USA locations should NOT be flagged as non-USA
    expect(isDefiniteNonUsaLocation('United States')).toBe(false);
    expect(isDefiniteNonUsaLocation('Austin, Texas, United States')).toBe(false);
    expect(isDefiniteNonUsaLocation('San Francisco Bay Area')).toBe(false);
    expect(isDefiniteNonUsaLocation('Greater Seattle Area')).toBe(false);
    expect(isDefiniteNonUsaLocation('New York, NY')).toBe(false);
    expect(isDefiniteNonUsaLocation('Chicago, IL')).toBe(false);
    expect(isDefiniteNonUsaLocation('')).toBe(false);
    expect(isDefiniteNonUsaLocation(null)).toBe(false);
  });

  it('classifies Indian background signals as KEEP without AI', () => {
    // Institution signals
    expect(classifyProspectByIndianCriteria({
      fullName: 'Alex Vance',
      headline: 'Software Engineer | IIT Bombay Alum',
      company: 'Tech Corp',
    })).toBe('KEEP');

    expect(classifyProspectByIndianCriteria({
      fullName: 'David M.',
      headline: 'Graduate Student at BITS Pilani',
    })).toBe('KEEP');

    // Indian IT / Tech service companies
    expect(classifyProspectByIndianCriteria({
      fullName: 'Sam Miller',
      headline: 'Data Analyst at TCS',
      company: 'Tata Consultancy Services',
    })).toBe('KEEP');

    expect(classifyProspectByIndianCriteria({
      fullName: 'Chris Jones',
      headline: 'Consultant at Infosys',
    })).toBe('KEEP');

    expect(classifyProspectByIndianCriteria({
      fullName: 'Taylor W.',
      headline: 'Ex-Wipro | Product Specialist',
    })).toBe('KEEP');
  });

  it('classifies common Indian names as KEEP without AI', () => {
    expect(classifyProspectByIndianCriteria({
      fullName: 'Rohan Sharma',
      headline: 'Data Analyst at Capital One',
    })).toBe('KEEP');

    expect(classifyProspectByIndianCriteria({
      fullName: 'Priya Patel',
      headline: 'BI Developer',
    })).toBe('KEEP');

    expect(classifyProspectByIndianCriteria({
      fullName: 'Amit Kumar',
      headline: 'Analytics Consultant',
    })).toBe('KEEP');

    expect(classifyProspectByIndianCriteria({
      fullName: 'Deepika Reddy',
      headline: 'Data Scientist at Amazon',
    })).toBe('KEEP');
  });

  it('classifies definite non-Indian names with no Indian signals as DROP', () => {
    expect(classifyProspectByIndianCriteria({
      fullName: 'John Smith',
      headline: 'Senior Data Analyst at ExxonMobil',
    })).toBe('DROP');

    expect(classifyProspectByIndianCriteria({
      fullName: 'Ada Lovelace',
      headline: 'Founding Engineer at Engine Co',
    })).toBe('DROP');

    expect(classifyProspectByIndianCriteria({
      fullName: 'Michael Brown',
      headline: 'Analytics Director',
    })).toBe('DROP');
  });

  it('classifies ambiguous candidates as AMBIGUOUS', () => {
    expect(classifyProspectByIndianCriteria({
      fullName: 'K. S.',
      headline: 'Data Analyst at Stripe',
    })).toBe('AMBIGUOUS');

    expect(classifyProspectByIndianCriteria({
      fullName: 'Zoya K.',
      headline: 'Data Analyst',
    })).toBe('AMBIGUOUS');
  });
});

describe('Audience Filter — 2-Stage Hybrid Execution in filterProspectsByCriteria', () => {
  const candidatePool = [
    {
      publicId: 'rohan-sharma',
      fullName: 'Rohan Sharma',
      headline: 'Data Analyst at TCS | Ex-Infosys',
      location: 'Austin, Texas, United States',
    },
    {
      publicId: 'priya-patel',
      fullName: 'Priya Patel',
      headline: 'Senior BI Engineer',
      location: 'San Jose, CA',
    },
    {
      publicId: 'amit-kumar',
      fullName: 'Amit Kumar',
      headline: 'Analytics Manager | IIT Delhi',
      location: 'Chicago, IL',
    },
    {
      publicId: 'rahul-gupta-india',
      fullName: 'Rahul Gupta',
      headline: 'Data Analyst at Infosys',
      location: 'Bengaluru, Karnataka, India', // Non-USA location
    },
    {
      publicId: 'john-smith',
      fullName: 'John Smith',
      headline: 'Senior Data Analyst at Walmart',
      location: 'Dallas, TX', // Definite non-Indian
    },
    {
      publicId: 'ada-lovelace',
      fullName: 'Ada Lovelace',
      headline: 'Chief Analyst',
      location: 'London, United Kingdom', // Non-USA location
    },
    {
      publicId: 'ambiguous-sam',
      fullName: 'Sam K.',
      headline: 'Data Analyst',
      location: 'Seattle, WA', // Ambiguous
    },
  ];

  it('satisfies targetCount using Stage 1 alone with 0 AI calls when enough matches exist', async () => {
    const aiPromptFn = vi.fn();

    const filtered = await filterProspectsByCriteria(
      candidatePool,
      'Indian origin in United States actively job searching',
      { targetCount: 2, aiPromptFn }
    );

    expect(aiPromptFn).not.toHaveBeenCalled();
    expect(filtered).toHaveLength(2);
    expect(filtered.map((p) => p.publicId)).toEqual(['rohan-sharma', 'priya-patel']);
  });

  it('drops non-USA candidates and non-Indian candidates deterministically in Stage 1', async () => {
    const aiPromptFn = vi.fn();

    const filtered = await filterProspectsByCriteria(
      candidatePool,
      '25 Indians in USA searching for Data Analyst job',
      { targetCount: 10, aiPromptFn }
    );

    const ids = filtered.map((p) => p.publicId);
    // Non-USA locations dropped
    expect(ids).not.toContain('rahul-gupta-india');
    expect(ids).not.toContain('ada-lovelace');
    // Definite non-Indian dropped
    expect(ids).not.toContain('john-smith');
    // Deterministic Stage 1 matches kept
    expect(ids).toContain('rohan-sharma');
    expect(ids).toContain('priya-patel');
    expect(ids).toContain('amit-kumar');
  });

  it('executes Stage 2 single-batch AI check when Stage 1 has fewer than targetCount and ambiguous leads exist', async () => {
    // Only 1 deterministic match, targetCount is 2, ambiguousSam exists
    const miniPool = [
      {
        publicId: 'rohan-sharma',
        fullName: 'Rohan Sharma',
        headline: 'Data Analyst',
        location: 'Austin, TX',
      },
      {
        publicId: 'ambiguous-sam',
        fullName: 'Sam K.',
        headline: 'Data Analyst',
        location: 'Seattle, WA',
      },
    ];

    const aiPromptFn = vi.fn().mockResolvedValue({
      text: '[0]', // Matches first candidate in ambiguous array (ambiguous-sam)
    });

    const filtered = await filterProspectsByCriteria(
      miniPool,
      'Indians in USA',
      { targetCount: 2, aiPromptFn }
    );

    expect(aiPromptFn).toHaveBeenCalledTimes(1);
    expect(filtered).toHaveLength(2);
    expect(filtered.map((p) => p.publicId)).toEqual(['rohan-sharma', 'ambiguous-sam']);
  });

  it('gracefully falls back to Stage 1 matches when Stage 2 AI call fails or hits 429', async () => {
    const miniPool = [
      {
        publicId: 'rohan-sharma',
        fullName: 'Rohan Sharma',
        headline: 'Data Analyst',
        location: 'Austin, TX',
      },
      {
        publicId: 'ambiguous-sam',
        fullName: 'Sam K.',
        headline: 'Data Analyst',
        location: 'Seattle, WA',
      },
    ];

    const aiPromptFn = vi.fn().mockRejectedValue(new Error('Rate limit exceeded: 429'));

    const filtered = await filterProspectsByCriteria(
      miniPool,
      'Indians in USA',
      { targetCount: 2, aiPromptFn }
    );

    // Does not throw; returns Stage 1 deterministic matches cleanly
    expect(filtered).toHaveLength(1);
    expect(filtered[0].publicId).toBe('rohan-sharma');
  });
});

describe('Audience Filter — Telegram Copilot Tool Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('over-fetches profiles and applies audienceFilter when searching leads', async () => {
    const sampleSearchProfiles = [
      {
        publicId: 'rohan-sharma',
        fullName: 'Rohan Sharma',
        headline: 'Data Analyst at TCS',
        location: 'Austin, TX',
      },
      {
        publicId: 'john-smith',
        fullName: 'John Smith',
        headline: 'Data Analyst at Dell',
        location: 'Austin, TX',
      },
      {
        publicId: 'rahul-in-india',
        fullName: 'Rahul Rao',
        headline: 'Data Analyst',
        location: 'Bengaluru, India',
      },
      {
        publicId: 'priya-patel',
        fullName: 'Priya Patel',
        headline: 'Data Analyst at Infosys',
        location: 'San Jose, CA',
      },
    ];

    vi.spyOn(voyager, 'searchProfiles').mockResolvedValue({
      profiles: sampleSearchProfiles,
      total: 4,
    });

    vi.spyOn(lists, 'ensureList').mockResolvedValue({ listId: 'test-list-123' });
    vi.spyOn(lists, 'add').mockResolvedValue({ added: 2 });

    const result = await executeToolCall('search_and_save_leads', {
      keywords: 'Data Analyst',
      location: 'United States',
      audienceFilter: 'Indian origin in United States actively job searching',
      count: 2,
      listName: 'Indian Analysts USA',
    });

    expect(voyager.searchProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        keywords: 'Data Analyst',
        location: 'United States',
        count: 6, // Math.min(2 * 3, 100) = 6
      })
    );

    expect(result.countFound).toBe(2);
    expect(result.totalSearched).toBe(4);
    expect(result.audienceFilter).toBe('Indian origin in United States actively job searching');
    expect(result.summaryMessage).toContain('Found 2 matching prospects (filtered from 4 searched');
    expect(result.listSaved).toBe(true);
    expect(result.topProfiles.map((p) => p.name)).toEqual(['Rohan Sharma', 'Priya Patel']);
  });

  it('auto-detects demographic keywords in search keywords and cleans LinkedIn query', async () => {
    vi.spyOn(voyager, 'searchProfiles').mockResolvedValue({
      profiles: [
        {
          publicId: 'aditya-verma',
          fullName: 'Aditya Verma',
          headline: 'Data Analyst at Capital One',
          location: 'Richmond, VA, United States',
        },
      ],
      total: 1,
    });

    const result = await executeToolCall('search_and_save_leads', {
      keywords: '25 Indians in USA searching for Data Analyst job',
      count: 1,
    });

    // Check that voyager was called with cleaned keywords without demographic pollution
    expect(voyager.searchProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        keywords: expect.stringMatching(/Data Analyst/i),
        location: 'United States',
      })
    );

    expect(result.audienceFilter).toBeTruthy();
    expect(result.countFound).toBe(1);
    expect(result.topProfiles[0].name).toBe('Aditya Verma');
  });
});
