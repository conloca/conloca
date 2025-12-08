import { z } from 'zod';

/**
 * Data collection schemas for the CMS.
 *
 * Each key is a collection name (matching folders in content/data/).
 * The CMS auto-generates forms from these Zod schemas.
 *
 * Tips:
 * - Use .describe() to add labels/hints shown in the form
 * - Use .optional() for non-required fields
 * - Supported types: string, number, boolean, date, email, url, arrays
 */
export const dataSchemas = {
  /**
   * Authors collection - blog post authors, team members, etc.
   */
  authors: z.object({
    name: z.string().describe('Full name'),
    bio: z.string().describe('Short biography'),
    avatar: z.string().url().optional().describe('Profile image URL'),
    twitter: z.string().optional().describe('Twitter handle (e.g., @username)'),
    email: z.string().email().optional().describe('Contact email'),
  }),

  /**
   * Testimonials collection - customer reviews, quotes, etc.
   */
  testimonials: z.object({
    quote: z.string().describe('Testimonial text'),
    author: z.string().describe('Person who gave testimonial'),
    company: z.string().optional().describe('Company name'),
    role: z.string().optional().describe('Job title or role'),
    rating: z.number().min(1).max(5).optional().describe('Rating from 1-5'),
  }),

  /**
   * Settings collection - site configuration, feature flags, etc.
   */
  settings: z.object({
    siteName: z.string().optional().describe('Site name'),
    tagline: z.string().optional().describe('Site tagline'),
    analyticsId: z.string().optional().describe('Google Analytics ID'),
    enableComments: z.boolean().optional().describe('Enable comments on posts'),
  }),
};
