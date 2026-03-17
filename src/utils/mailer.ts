import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendWelcomeEmail = async (userEmail, userName) => {
  try {
    const data = await resend.emails.send({
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