/**
 * @file Auth bridge for EduAI API calls.
 *
 * AI Tutor forwards the user's Core session
 * cookie on every user-scoped EduAI API call. 
 * This file provides the cookie extraction helper.
 */

/**
 * Extract the raw Cookie header from the incoming request for forwarding to
 * EduAI API calls on behalf of the user.
 */
export function getEduAiCookieForRequest(req) {
  return req.headers.cookie ?? '';
}
