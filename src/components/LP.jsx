import { GoogleLogin } from '@react-oauth/google';

function LandingPage({ onLoginSuccess, onLoginError }) {
  return (
    <div className="bg-white">
      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-2 rounded-lg">
                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"></path>
                </svg>
              </div>
              <span className="text-xl font-bold text-gray-900">RUKMER AI</span>
            </div>
            <div className="flex items-center gap-6">
              <a href="#how-it-works" className="hidden md:block text-gray-600 hover:text-gray-900 font-medium">How It Works</a>
              <a href="#pricing" className="hidden md:block text-gray-600 hover:text-gray-900 font-medium">Pricing</a>
              {/* Directs user to the Hero section where the login button is */}
              <a href="#login-area" className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 font-medium transition-colors">
                Log In
              </a>
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-blue-50 to-indigo-50 pt-20 pb-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-medium mb-6">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"></path>
                </svg>
                Powered by Rukmer AI
              </div>
              <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight mb-6">
                Professional Site Reports in <span className="text-blue-600">2 Minutes</span>
              </h1>
              <p className="text-xl text-gray-600 mb-8">
                Stop wasting 4+ hours writing progress reports. Upload photos, get AI-powered insights, export and send.
              </p>
              
              {/* Login Area */}
              <div id="login-area" className="flex flex-col sm:flex-row gap-4 items-center sm:items-start">
                <div className="bg-white p-1 rounded-full shadow-md border border-gray-200">
                    <GoogleLogin 
                        onSuccess={onLoginSuccess} 
                        onError={onLoginError} 
                        text="signup_with"
                        shape="pill"
                        size="large"
                    />
                </div>
                <div className="text-sm text-gray-500 mt-2 sm:mt-0 sm:self-center">
                  Start for free. No credit card required.
                </div>
              </div>
            </div>

            {/* Hero Image / Graphic */}
            <div className="relative mt-10 md:mt-0">
              <div className="bg-white rounded-2xl shadow-2xl p-6 border border-gray-200">
                <div className="bg-gray-100 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-300 h-24 rounded"></div>
                    <div className="bg-gray-300 h-24 rounded"></div>
                    <div className="bg-gray-300 h-24 rounded"></div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="h-4 bg-blue-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                </div>
                <div className="mt-4 flex gap-2">
                  <div className="flex-1 bg-green-500 text-white text-xs py-2 rounded text-center font-medium">✓ AI Analyzed</div>
                  <div className="flex-1 bg-blue-500 text-white text-xs py-2 rounded text-center font-medium">↓ Download</div>
                </div>
              </div>
              <div className="absolute -top-4 -right-4 bg-yellow-400 text-yellow-900 px-4 py-2 rounded-full font-bold text-sm shadow-lg rotate-12">
                2 min ⚡
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="py-20 bg-gradient-to-br from-gray-50 to-blue-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
                <h2 className="text-4xl font-bold text-gray-900 mb-4">
                    Simple, Transparent Pricing
                </h2>
                <p className="text-xl text-gray-600">Start free. Upgrade when you need more.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
                {/* Free Tier */}
                <div className="bg-white rounded-2xl shadow-lg p-8 border-2 border-gray-200">
                    <div className="mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 mb-2">Free</h3>
                        <div className="text-5xl font-bold text-gray-900 mb-2">$0</div>
                        <p className="text-gray-600">Try it out</p>
                    </div>
                    <ul className="space-y-4 mb-8">
                        <li className="flex items-start gap-3">
                            <span className="text-green-500">✓</span>
                            <span className="text-gray-700">3 reports per month</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="text-green-500">✓</span>
                            <span className="text-gray-700">Basic AI analysis</span>
                        </li>
                    </ul>
                    <a href="#login-area" className="block w-full bg-gray-200 text-gray-900 py-3 rounded-lg font-semibold text-center hover:bg-gray-300 transition-colors">
                        Start Free
                    </a>
                </div>

                {/* Pro Tier */}
                <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-2xl shadow-2xl p-8 border-2 border-blue-500 relative transform md:scale-105">
                    <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-yellow-400 text-yellow-900 px-4 py-1 rounded-full text-sm font-bold">
                        MOST POPULAR
                    </div>
                    <div className="mb-6">
                        <h3 className="text-2xl font-bold text-white mb-2">Pro</h3>
                        <div className="text-5xl font-bold text-white mb-2">$29<span className="text-2xl">/mo</span></div>
                        <p className="text-blue-100">For professionals</p>
                    </div>
                    <ul className="space-y-4 mb-8">
                        <li className="flex items-start gap-3">
                             <span className="text-blue-200">✓</span>
                            <span className="text-white font-medium">50 reports per month</span>
                        </li>
                        <li className="flex items-start gap-3">
                             <span className="text-blue-200">✓</span>
                            <span className="text-white font-medium">Advanced AI insights</span>
                        </li>
                        <li className="flex items-start gap-3">
                             <span className="text-blue-200">✓</span>
                            <span className="text-white font-medium">Custom branding</span>
                        </li>
                    </ul>
                    <a href="#login-area" className="block w-full bg-white text-blue-600 py-3 rounded-lg font-bold text-center hover:bg-blue-50 transition-colors">
                        Start Pro Trial
                    </a>
                </div>

                {/* Business Tier */}
                <div className="bg-white rounded-2xl shadow-lg p-8 border-2 border-gray-200">
                    <div className="mb-6">
                        <h3 className="text-2xl font-bold text-gray-900 mb-2">Business</h3>
                        <div className="text-5xl font-bold text-gray-900 mb-2">$99<span className="text-2xl">/mo</span></div>
                        <p className="text-gray-600">For teams</p>
                    </div>
                    <ul className="space-y-4 mb-8">
                        <li className="flex items-start gap-3">
                            <span className="text-green-500">✓</span>
                            <span className="text-gray-700 font-medium">Unlimited reports</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <span className="text-green-500">✓</span>
                            <span className="text-gray-700 font-medium">Team collaboration</span>
                        </li>
                    </ul>
                    <a href="#login-area" className="block w-full bg-blue-600 text-white py-3 rounded-lg font-semibold text-center hover:bg-blue-700 transition-colors">
                        Contact Sales
                    </a>
                </div>
            </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="py-20 bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-4xl font-bold text-gray-900 mb-12 text-center">Frequently Asked Questions</h2>
            <div className="space-y-6">
                <div className="border-b border-gray-200 pb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">How accurate is the AI analysis?</h3>
                    <p className="text-gray-600">Rukmer AI uses state-of-the-art vision models to identify progress, quality issues, and safety concerns with industry-leading accuracy.</p>
                </div>
                <div className="border-b border-gray-200 pb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Is my data secure?</h3>
                    <p className="text-gray-600">Yes. All images and reports are encrypted in transit and at rest. We never share your data with third parties.</p>
                </div>
                 <div className="border-b border-gray-200 pb-6">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">Can I cancel anytime?</h3>
                    <p className="text-gray-600">Yes. Cancel anytime from your account settings. No questions asked.</p>
                </div>
            </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="border-t border-gray-800 pt-8 text-center">
            <p className="text-gray-400 text-sm">
              © 2026 Rukmer AI. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default LandingPage;