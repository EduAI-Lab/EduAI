/**
 * Resource-level RBAC middleware for routes addressed by a resource id
 * (variant / question / assessment / section) rather than a course id.
 *
 * Each guard loads the resource together with its full owning `Course` row
 * (userId + coreCourseId are required for owner-scoping and the Core enrollment
 * lookup, so loaders deliberately do NOT restrict course attributes), resolves
 * the caller's access from that course, 404s a missing resource and 403s
 * insufficient access, then attaches the resource, `req.qmCourse`, and
 * `req.courseAccess` for downstream handlers.
 */
import { Variants, Question_Metadata, Assessments, Course } from '../schema/index.js';
import { resolveAccessForCourse, minRank } from './courseAccess.js';

/**
 * Parse a route id into a positive integer, or null when it isn't one. The schema PKs
 * are INTEGER, so a non-numeric id (`Number('abc')` → NaN) must never reach the query —
 * Postgres rejects NaN with `invalid input syntax for type integer`, which errorHandler
 * leaks as a 500. A null here makes the guard 404 (resource not found), mirroring
 * `courseAccess.resolveCourseAccessWithCourse`.
 */
function parseResourceId(raw) {
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

function makeGuard({ min, attachAs, loader }) {
  const required = minRank(min);
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      const { resource, course } = (await loader(req)) ?? {};
      if (!resource || !course) {
        return res.status(404).json({ success: false, error: 'Resource not found' });
      }

      const access = await resolveAccessForCourse(req.user, course, { cookie: req.headers.cookie });
      if (!access || access.rank < required) {
        return res.status(403).json({ success: false, error: 'Insufficient course access' });
      }

      req[attachAs] = resource;
      req.qmCourse = course;
      req.courseAccess = access;
      next();
    } catch (error) {
      next(error);
    }
  };
}

const variantInclude = {
  model: Question_Metadata,
  as: 'questionMetadata',
  include: [{ model: Course, as: 'course' }],
};

/** Gate a variant route (`:variantId`); attaches `req.variant`. */
export function requireVariantAccess({ min } = { min: 'ta' }) {
  return makeGuard({
    min,
    attachAs: 'variant',
    loader: async (req) => {
      const id = parseResourceId(req.params.variantId);
      if (id === null) return null;
      const variant = await Variants.findOne({
        where: { id },
        include: [variantInclude],
      });
      return { resource: variant, course: variant?.questionMetadata?.course };
    },
  });
}

/** Gate a question route; attaches `req.question`. Defaults to the `:id` param. */
export function requireQuestionAccess({ min = 'ta', param = 'id' } = {}) {
  return makeGuard({
    min,
    attachAs: 'question',
    loader: async (req) => {
      const id = parseResourceId(req.params[param]);
      if (id === null) return null;
      const question = await Question_Metadata.findOne({
        where: { id },
        include: [{ model: Course, as: 'course' }],
      });
      return { resource: question, course: question?.course };
    },
  });
}

/**
 * Gate an assessment route; attaches `req.assessment`. Defaults to the `:id`
 * param. Section write routes gate on their parent `:assessmentId` (sections
 * inherit assessment access per §17), so a dedicated section guard isn't needed.
 */
export function requireAssessmentAccess({ min, param = 'id' } = {}) {
  return makeGuard({
    min,
    attachAs: 'assessment',
    loader: async (req) => {
      const id = parseResourceId(req.params[param]);
      if (id === null) return null;
      const assessment = await Assessments.findOne({
        where: { id },
        include: [{ model: Course, as: 'course' }],
      });
      return { resource: assessment, course: assessment?.course };
    },
  });
}
