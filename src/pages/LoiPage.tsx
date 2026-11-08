import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import LoiDocument from '../components/LoiDocument';

export default function LoiPage() {
  useEffect(() => {
    const previous = document.title;
    document.title = 'Rukmer Customer Letter of Intent | Rukmer Inc.';
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    const previousDescription = meta.getAttribute('content');
    meta.setAttribute(
      'content',
      'Rukmer Customer Letter of Intent. Rukmer Inc., 25 N New Jersey St, Indianapolis, IN 46204. Customers keep ownership of their data and Company Brain.'
    );
    return () => {
      document.title = previous;
      if (previousDescription) meta.setAttribute('content', previousDescription);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#f3f3f4] text-black">
      <div className="max-w-3xl mx-auto px-5 py-12 sm:py-16">
        <Link to="/signup" className="text-sm underline underline-offset-4">Back to signup</Link>
        <div className="mt-6 bg-white border border-black/10 rounded-2xl p-6 sm:p-10">
          <LoiDocument />
        </div>
        <p className="mt-6 text-sm text-black/50">
          Also see the <a className="underline" href="/terms.html">Terms</a> and <a className="underline" href="/privacy.html">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}
