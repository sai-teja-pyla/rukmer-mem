import dotenv from 'dotenv';
import { LOI_BLOCKS, LOI_TITLE, LOI_VERSION } from '../legal/loi.js';

dotenv.config();

type ResendClient = { emails: { send: (body: Record<string, unknown>) => Promise<unknown> } };
let resendClient: ResendClient | null = null;

async function resend() {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  if (!resendClient) {
    const { Resend } = await import('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY) as ResendClient;
  }
  return resendClient;
}

export type TeamInviteMail = {
  to: string;
  teamName: string;
  inviterName: string;
  inviteUrl: string;
  subject: string;
  html: string;
};

let teamInviteTransport: ((input: TeamInviteMail) => Promise<{ success: boolean }>) | null = null;

export function setTeamInviteMailerForTests(fn: ((input: TeamInviteMail) => Promise<{ success: boolean }>) | null) {
  teamInviteTransport = fn;
}

export const sendWelcomeEmail = async (userEmail, userName) => {
  try {
    const data = await (await resend()).emails.send({
      // Once you verify rukmer.com in Resend, change this to teja@rukmer.com
      from: 'Rukmer AI <support@rukmer.com>', 
      to: userEmail,
      subject: 'Welcome to Rukmer AI - Unlocking your Dark Data',
      html: `
        <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
          <h2>Hi ${userName},</h2>
          <p>Thanks for joining Rukmer AI. We’re on a mission to help you turn untapped images, videos, and documents into actionable insights.</p>
          
          <p>Since we're just getting started, I have to ask: <strong>What brings you to Rukmer today?</strong> Are you looking to automate documentation, or is there a specific project you're trying to unlock?</p>

          <p>Feel free to hit reply and let me know—I’d love to make sure the platform is hitting the mark for you.</p>

          <p><strong>Pro Tip:</strong> You can upload files from 500MB up to 5GB right now. Most platforms can't handle that, but we built Rukmer specifically for heavy-duty visual data.</p>
          
          <p>Best,<br />
          <strong>Teja</strong><br />
          Founder, Rukmer AI</p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          
          <p style="font-size: 0.85em; color: #666;">
            <strong>PS:</strong> I respond to every email personally. If you have a question or a feature request, just reach out!
          </p>
        </div>
      `,
    });
    return { success: true, data };
  } catch (error) {
    console.error("Email failed to send:", error);
    return { success: false, error };
  }
};

const LOI_COPY_TO = ['saiteja@rukmer.com', 'suren@rukmer.com'];

function letterText() {
  const body = LOI_BLOCKS.map((block) => {
    const head = block.heading ? `${block.heading}\n` : '';
    return head + block.paragraphs.join('\n\n');
  }).join('\n\n');
  return `${LOI_TITLE}\nVersion ${LOI_VERSION}\n\n${body}\n\nRukmer Inc.\n25 N New Jersey St\nIndianapolis, IN 46204\n\nCustomer\nAccepted electronically upon account creation.`;
}

export async function sendTeamInviteEmail(input: { to: string; teamName: string; inviterName: string; inviteUrl: string }) {
  const subject = `${input.inviterName || 'A teammate'} invited you to join ${input.teamName || 'a team'} on Rukmer`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.6; color: #333;">
      <p>${subject}.</p>
      <p><a href="${input.inviteUrl}">Accept invite</a></p>
      <p style="font-size: 0.85em; color: #666;">This link expires in 7 days and works once for ${input.to}.</p>
    </div>
  `;
  const message = { ...input, subject, html };
  if (teamInviteTransport) return teamInviteTransport(message);
  try {
    const data = await (await resend()).emails.send({
      from: 'Rukmer AI <support@rukmer.com>',
      to: input.to,
      subject,
      html,
    });
    return { success: true, data };
  } catch (error) {
    console.error('Team invite email failed:', (error as Error)?.message || error);
    return { success: false, error };
  }
}

/** Sends the founders a stored copy of the letter the customer just accepted. */
export const sendLoiCopy = async (input: {
  name: string;
  email: string;
  uid: string;
  acceptedAt: string;
  ip: string;
  userAgent: string;
}) => {
  const who = [input.name, input.email, input.uid].filter(Boolean).join(' · ');
  const text = [
    `Accepted by: ${who}`,
    `Accepted at: ${input.acceptedAt}`,
    `Version: ${LOI_VERSION}`,
    `IP: ${input.ip || 'unknown'}`,
    `User agent: ${input.userAgent || 'unknown'}`,
    '',
    letterText(),
  ].join('\n');
  try {
    const data = await (await resend()).emails.send({
      from: 'Rukmer AI <support@rukmer.com>',
      to: LOI_COPY_TO,
      subject: `LOI accepted — ${input.email || input.uid} — ${LOI_VERSION}`,
      text,
    });
    return { success: true, data };
  } catch (error) {
    console.error('LOI copy email failed:', (error as Error)?.message || error);
    return { success: false, error };
  }
};