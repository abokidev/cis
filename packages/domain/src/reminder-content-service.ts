/**
 * UX-RET-007 v2.3 — Reminder & Recovery Message Content (Phase 17).
 *
 * This service owns WHAT a reminder says. UX-OPS-004 (Phase 13) owns WHEN it fires.
 *
 * Invariants:
 *  - STOP is carried on every scheduled reminder. The only STOP-free message is
 *    the one-time initial link delivery (Phase 3/9), which is not in the reminder
 *    cadence at all.
 *  - Progress wording is computed from the respondent's actual answered-item count,
 *    never from fixed copy.
 *  - Channel is inherited from Phase 3's UX-RET-001 selection; never re-chosen here.
 *  - Stopping reminders sets reminders_opted_out without altering consent or
 *    participation status. No WhatsApp variants (DEC-010).
 */

import { Pool } from 'pg';
import {
  getLiveContent,
  optOutReminders,
  getRespondentProgress,
  type RespondentProgress,
} from '@cis/db';
import { DomainError } from './errors';

export class ReminderContentError extends DomainError {
  constructor(message: string, code = 'REMINDER_CONTENT') {
    super(message, code);
  }
}

export type ReminderSubKey =
  | 'first_message_email'
  | 'first_message_text'
  | 'reminder_email'
  | 'reminder_text'
  | 'reminders_stopped'
  | 'already_submitted'
  | 'link_tapped';

export { type RespondentProgress };

/**
 * Compute progress wording from the respondent's actual answered-item count.
 * Returns a human phrase like "about halfway through" or "around five minutes left".
 */
export function computeProgressWording(answered: number, total: number): string {
  if (total <= 0) return '';
  const ratio = answered / total;
  if (ratio <= 0) return '';
  if (ratio < 0.25) return 'You have just started — most of the survey is still ahead.';
  if (ratio < 0.45) return 'You are about a quarter of the way through — around ten minutes left.';
  if (ratio < 0.6) return 'You are about halfway through — around five minutes left.';
  if (ratio < 0.8) return 'You are more than halfway — just a few minutes to go.';
  return 'You are nearly done — just a couple of questions left.';
}

/** Read the live body for a reminder_content sub-key from the managed-content store. */
export async function getReminderContent(pool: Pool, subKey: ReminderSubKey): Promise<string> {
  const live = await getLiveContent(pool, 'reminder_content', subKey);
  if (!live) {
    throw new ReminderContentError(
      `No live content for reminder_content/${subKey}`,
      'CONTENT_NOT_FOUND',
    );
  }
  return live.version.body;
}

/**
 * Mark a respondent as no longer wanting reminders.
 * Does NOT touch consent_accepted, submitted_at, or any other participation field.
 * The respondent remains fully eligible to return and complete their response.
 */
export async function stopReminders(pool: Pool, respondentId: string): Promise<void> {
  await optOutReminders(pool, respondentId);
}

/** Assemble a reminder text body with dynamic progress wording and recovery URL. */
export async function assembleReminderText(
  pool: Pool,
  respondentId: string,
  recoveryUrl: string,
): Promise<string> {
  const [template, progress] = await Promise.all([
    getReminderContent(pool, 'reminder_text'),
    getRespondentProgress(pool, respondentId),
  ]);
  const wording = computeProgressWording(progress.answered, progress.total);
  return template
    .replace('{{progress_wording}}', wording ? wording + ' ' : '')
    .replace('{{recovery_url}}', recoveryUrl);
}

/** Assemble the first-message text body (no STOP, no progress). */
export async function assembleFirstMessageText(pool: Pool, recoveryUrl: string): Promise<string> {
  const template = await getReminderContent(pool, 'first_message_text');
  return template.replace('{{recovery_url}}', recoveryUrl);
}
