import Stripe from 'stripe';
import pool from '../config/db.js'; // Adjust if your db.js is elsewhere

// Initialize Stripe with your secret key from the .env file
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const stripeWebhookHandler = async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        // This is why we needed express.raw() in server.js!
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.error(`❌ Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle successful payments and subscriptions
    if (event.type === 'customer.subscription.created' || event.type === 'invoice.payment_succeeded') {
        const invoice = event.data.object;
        const customerEmail = invoice.customer_email;

        if (customerEmail) {
            try {
                // Update PostgreSQL to grant Pro status
                await pool.query(
                    `UPDATE users SET is_pro = TRUE, plan_type = 'pro' WHERE email = $1`,
                    [customerEmail]
                );
                console.log(`✅ Granted Pro Status in Postgres for: ${customerEmail}`);
            } catch (dbError) {
                console.error("🚨 Database error updating Pro status:", dbError);
            }
        }
    }

    res.json({ received: true });
};