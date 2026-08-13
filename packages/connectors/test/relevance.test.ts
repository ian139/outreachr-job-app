import { describe, expect, it } from 'vitest';
import {
  JOB_RELEVANT_GMAIL_QUERY,
  composeGmailThreadQuery,
  isJobRelevantMailMetadata,
} from '../src/relevance.js';

type Fixture = {
  name: string;
  subject: string;
  fromName?: string;
  fromAddress?: string;
  bodyPreview?: string;
  relevant: boolean;
};

const fixtures: Fixture[] = [
  {
    name: 'NBA schedule',
    subject: 'NBA schedule: this week\'s games',
    fromName: 'NBA Daily',
    fromAddress: 'updates@nba.example',
    relevant: false,
  },
  {
    name: 'sports ticket offer',
    subject: 'Ticket offer: save 20% on playoff tickets',
    fromName: 'Arena Tickets',
    fromAddress: 'offers@arena.example',
    relevant: false,
  },
  {
    name: 'generic promotion',
    subject: 'Exclusive offer just for you',
    fromName: 'Example Marketing',
    fromAddress: 'marketing@example.com',
    relevant: false,
  },
  {
    name: 'newsletter with job words',
    subject: 'Jobs newsletter: career opportunities and hiring news',
    fromName: 'Industry Newsletter',
    fromAddress: 'newsletter@industry.example',
    relevant: false,
  },
  {
    name: 'generic offer',
    subject: 'Offer',
    fromName: 'Alex',
    fromAddress: 'alex@example.com',
    relevant: false,
  },
  {
    name: 'generic schedule',
    subject: 'Schedule',
    fromName: 'Alex',
    fromAddress: 'alex@example.com',
    relevant: false,
  },
  {
    name: 'generic application',
    subject: 'Application',
    fromName: 'Alex',
    fromAddress: 'alex@example.com',
    relevant: false,
  },
  {
    name: 'generic jobs sender',
    subject: 'Hello',
    fromName: 'Jobs',
    fromAddress: 'jobs@example.com',
    relevant: false,
  },
  {
    name: 'generic careers sender',
    subject: 'Welcome',
    fromName: 'Careers',
    fromAddress: 'careers@example.com',
    relevant: false,
  },
  {
    name: 'generic hr sender',
    subject: 'Hello',
    fromName: 'HR',
    fromAddress: 'hr@example.com',
    relevant: false,
  },
  {
    name: 'interview correspondence',
    subject: 'Interview invitation for Senior Engineer',
    fromName: 'Acme Recruiter',
    fromAddress: 'recruiter@acme.example',
    relevant: true,
  },
  {
    name: 'application status',
    subject: 'Your application status update',
    fromName: 'Acme Hiring Team',
    fromAddress: 'hiring@acme.example',
    relevant: true,
  },
  {
    name: 'recruiter outreach',
    subject: 'Recruiter outreach: Senior Engineer opportunity',
    fromName: 'Jane Recruiter',
    fromAddress: 'jane@acme.example',
    relevant: true,
  },
  {
    name: 'offer letter',
    subject: 'Your offer letter from Acme',
    fromName: 'Acme People Team',
    fromAddress: 'people@acme.example',
    relevant: true,
  },
  {
    name: 'application rejection',
    subject: 'Application rejected - next steps',
    fromName: 'Acme Recruiting',
    fromAddress: 'recruiting@acme.example',
    relevant: true,
  },
  {
    name: 'interview next steps',
    subject: 'Next steps in the interview process',
    fromName: 'Acme Hiring Manager',
    fromAddress: 'manager@acme.example',
    relevant: true,
  },
  {
    name: 'corroborated weak signals',
    subject: 'Offer for the product role',
    fromName: 'Acme Talent Team',
    fromAddress: 'talent@acme.example',
    relevant: true,
  },
  {
    name: 'weak signals with promotion override',
    subject: 'Offer for your career - 20% discount',
    fromName: 'Acme Marketing',
    fromAddress: 'marketing@acme.example',
    relevant: false,
  },
  {
    name: 'weak signals with unsubscribe override',
    subject: 'Jobs and careers update',
    fromName: 'Acme Updates',
    fromAddress: 'updates@acme.example',
    bodyPreview: 'Read our newsletter and unsubscribe any time',
    relevant: false,
  },
  {
    name: 'unambiguous interview despite unsubscribe footer',
    subject: 'Interview invitation',
    fromName: 'Acme Recruiter',
    fromAddress: 'recruiter@acme.example',
    bodyPreview: 'Please choose a time. Unsubscribe links are included by our mail provider.',
    relevant: true,
  },
  {
    name: 'unambiguous application status despite sports word',
    subject: 'Application status update for NBA analytics role',
    fromName: 'Acme Hiring Team',
    fromAddress: 'hiring@acme.example',
    relevant: true,
  },
  {
    name: 'sender boundary does not match through',
    subject: 'Through the week',
    fromName: 'Through Team',
    fromAddress: 'through@example.com',
    relevant: false,
  },
  {
    name: 'sender boundary does not match notjobs',
    subject: 'Welcome',
    fromName: 'Not Jobs',
    fromAddress: 'notjobs@example.com',
    relevant: false,
  },
  {
    name: 'NBA careers schedule',
    subject: 'Careers: schedule of NBA draft combine events',
    fromName: 'NBA Careers Team',
    fromAddress: 'careers@nba.example',
    relevant: false,
  },
  {
    name: 'sales engineer role',
    subject: 'Sales Engineer opportunity at Acme',
    fromName: 'Acme Recruiter',
    fromAddress: 'recruiter@acme.example',
    relevant: true,
  },
  {
    name: 'marketing manager opportunity',
    subject: 'Marketing Manager opportunity at Acme',
    fromName: 'Acme Recruiting',
    fromAddress: 'recruiting@acme.example',
    relevant: true,
  },
  {
    name: 'marketing without promo corroboration is not promotional',
    subject: 'Marketing update for our customers',
    fromName: 'Acme Marketing Team',
    fromAddress: 'marketing@acme.example',
    bodyPreview: 'What is new in the Acme platform.',
    relevant: false,
  },
  {
    name: 'occupational term with promo corroboration is promotional',
    subject: 'Sales special: coupon inside for 30% off',
    fromName: 'Acme Sales',
    fromAddress: 'sales@acme.example',
    relevant: false,
  },
  {
    name: 'interviews plural parity',
    subject: 'Interviews scheduled for the candidate',
    fromName: 'Acme Recruiting',
    fromAddress: 'recruiting@acme.example',
    relevant: true,
  },
  {
    name: 'candidates plural parity',
    subject: 'Candidates review for open positions',
    fromName: 'Acme Talent Team',
    fromAddress: 'talent@acme.example',
    relevant: true,
  },
  {
    name: 'jobs plural parity',
    subject: 'Open jobs for career growth',
    fromName: 'Acme Careers Team',
    fromAddress: 'careers@acme.example',
    relevant: true,
  },
  {
    name: 'hr does not match inside chrome',
    subject: 'Chrome browser update',
    fromName: 'Chrome Team',
    fromAddress: 'chrome@example.com',
    relevant: false,
  },
  {
    name: 'candidate does not match inside noncandidate',
    subject: 'Noncandidate news',
    fromName: 'Acme Engineering',
    fromAddress: 'eng@acme.example',
    relevant: false,
  },
];

describe('job-relevant metadata classifier', () => {
  it.each(fixtures)('$name => $relevant', ({ subject, fromName, fromAddress, bodyPreview, relevant }) => {
    expect(isJobRelevantMailMetadata(subject, fromName, fromAddress, bodyPreview)).toBe(relevant);
  });

  it('publishes a Gmail query with corroboration and scoped negative exclusions', () => {
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('"application status"');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('"offer letter"');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('-subject:');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('-from:');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('newsletter');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('tickets');
    // NBA/sports/discount/coupon sender exclusions (with plural variants).
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('nba');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('sports');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('discount');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('coupon');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('coupons');
    // Occupational sales/marketing terms are not unconditionally excluded.
    expect(JOB_RELEVANT_GMAIL_QUERY).not.toContain('marketing');
    expect(JOB_RELEVANT_GMAIL_QUERY).not.toContain('sales');
    // Inflections are enumerated explicitly (no Gmail stemming).
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('interviews');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('candidates');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('jobs');
    expect(JOB_RELEVANT_GMAIL_QUERY).toContain('opportunities');
    // The whole relevance disjunction is parenthesized so user search tokens
    // appended by composeGmailThreadQuery constrain every branch, not only
    // the last OR branch.
    expect(JOB_RELEVANT_GMAIL_QUERY.startsWith('(')).toBe(true);
    expect(JOB_RELEVANT_GMAIL_QUERY.endsWith(')')).toBe(true);
    expect(
      composeGmailThreadQuery('job-relevant', 'application'),
    ).toBe(`${JOB_RELEVANT_GMAIL_QUERY} "application"`);
  });
});
