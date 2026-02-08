import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, FileText, Download, Loader2, Check, X, Sparkles, AlertCircle, MessageCircle, Send, Paperclip, RotateCcw } from 'lucide-react';
import { GoogleLogin } from '@react-oauth/google';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import { jwtDecode } from 'jwt-decode';

export default function SnapReportAI() {
  const [images, setImages] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState(null);
  const [projectName, setProjectName] = useState('');
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const fileInputRef = useRef(null);
  const [serverMessage, setServerMessage] = useState("");
  // Google OAuth user state
  const [user, setUser] = useState(null);

  const handleLoginSuccess = (credentialResponse) => {
    try {
      // Decode the encrypted token to get name/email/picture
      const decoded = jwtDecode(credentialResponse.credential);
      console.log("Login Success! User:", decoded);
      setUser(decoded); // This switches the screen to Dashboard
    } catch (error) {
      console.error("Token decoding failed:", error);
    }
  };

  const handleLoginError = () => {
    console.log('Login Failed');
  };

  const handleLogout = () => {
    console.log("Log Out Signal Received!"); // <--- Watch your console for this
    setUser(null); // This wipes the user and forces the Landing Page to show
  };



  const handleError = () => {
    console.log('Login Failed');
  };



  // Chatbot states
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Initialize chatbot with welcome message
  useEffect(() => {
    if (images.length > 0 && chatMessages.length === 0) {
      setChatMessages([{
        role: 'assistant',
        content: "👋 Hi! I'm your AI assistant for visual site analysis.\n\nI can help you:\n• Analyze specific details in your images\n• Identify defects and structural issues\n• Estimate measurements and surface areas\n• Assess safety concerns\n• Provide construction recommendations\n\nUpload your images and generate a report, then ask me anything!"
      }]);
    }
  }, [images]);

  useEffect(() => {
    // Note: We are fetching from port 5001
    fetch('http://localhost:5001/api/test')
      .then(res => res.json())
      .then(data => setServerMessage(data.message))
      .catch(err => console.error("Connection Error:", err));
  }, []);

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const newImages = files.map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      preview: URL.createObjectURL(file),
      analyzed: false
    }));
    setImages(prev => [...prev, ...newImages]);
  };

  const removeImage = (id) => {
    setImages(prev => prev.filter(img => img.id !== id));
  };

  const analyzeImages = async () => {
    if (images.length === 0) return;
    
    setAnalyzing(true);
    
    try {
      const imagePromises = images.map(async (img) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({
            id: img.id,
            data: reader.result.split(',')[1]
          });
          reader.onerror = reject;
          reader.readAsDataURL(img.file);
        });
      });

      const base64Images = await Promise.all(imagePromises);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'text',
                text: `You are analyzing construction/site progress images to generate a professional progress report. 

For each image, provide:
1. A descriptive title
2. Key observations (what work is shown, progress indicators)
3. Quality assessment (good/attention needed/risk)
4. Specific findings

Then provide an overall summary with:
- Overall progress status
- Key accomplishments
- Areas requiring attention
- Recommended next steps

Format your response ONLY as valid JSON with this structure:
{
  "images": [
    {
      "title": "string",
      "observations": "string",
      "quality": "good|attention|risk",
      "findings": ["string"]
    }
  ],
  "summary": {
    "status": "on_track|delayed|ahead",
    "accomplishments": ["string"],
    "concerns": ["string"],
    "nextSteps": ["string"]
  }
}`
              },
              ...base64Images.map(img => ({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: img.data
                }
              }))
            ]
          }]
        })
      });

      const data = await response.json();
      const analysisText = data.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');

      const cleanText = analysisText.replace(/```json|```/g, '').trim();
      const analysis = JSON.parse(cleanText);

      const analyzedImages = images.map((img, idx) => ({
        ...img,
        ...analysis.images[idx],
        analyzed: true
      }));

      setImages(analyzedImages);
      setReport({
        projectName: projectName || 'Untitled Project',
        date: reportDate,
        totalImages: images.length,
        summary: analysis.summary,
        generatedAt: new Date().toLocaleString()
      });

      // Add AI message about report completion
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ **Report Generated Successfully!**\n\nI've analyzed **${images.length} images** for "${projectName || 'your project'}".\n\n**Project Status:** ${analysis.summary.status.replace('_', ' ').toUpperCase()}\n\n**Key Findings:**\n${analysis.summary.accomplishments.slice(0, 2).map(item => `• ${item}`).join('\n')}\n\nFeel free to ask me specific questions about any image, defects, measurements, or recommendations!`
      }]);

    } catch (error) {
      console.error('Analysis failed:', error);
      alert('Failed to analyze images. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMessage = chatInput.trim();
    setChatInput('');
    setChatLoading(true);

    // Add user message
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      // Prepare context: include report data and images
      const imagePromises = images.map(async (img) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({
            id: img.id,
            title: img.title,
            data: reader.result.split(',')[1]
          });
          reader.onerror = reject;
          reader.readAsDataURL(img.file);
        });
      });

      const base64Images = await Promise.all(imagePromises);

      // Build conversation history
      const conversationHistory = chatMessages.slice(-6).map(msg => ({
        role: msg.role,
        content: msg.content
      }));

      // Prepare system context
      let contextText = `You are an AI assistant helping with construction site analysis. `;
      
      if (report) {
        contextText += `The user has generated a report for "${report.projectName}" with ${report.totalImages} images. 
        
Report Summary:
- Status: ${report.summary.status}
- Accomplishments: ${report.summary.accomplishments.join(', ')}
- Concerns: ${report.summary.concerns.join(', ')}
- Next Steps: ${report.summary.nextSteps.join(', ')}

Image Details:
${images.map((img, idx) => `Image ${idx + 1}: ${img.title} - ${img.observations} (Quality: ${img.quality})`).join('\n')}
`;
      } else {
        contextText += `The user has uploaded ${images.length} construction/site images but hasn't generated a report yet. Encourage them to generate the report first for detailed analysis.`;
      }

      contextText += `\n\nAnswer the user's question based on the images and report data. Be specific, professional, and helpful. If asked about measurements or areas, provide estimates. If asked about defects or issues, reference specific images. Use markdown formatting for better readability.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1500,
          messages: [
            ...conversationHistory,
            {
              role: 'user',
              content: [
                { type: 'text', text: contextText },
                { type: 'text', text: `User question: ${userMessage}` },
                ...base64Images.slice(0, 3).map(img => ({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: img.data
                  }
                }))
              ]
            }
          ]
        })
      });

      const data = await response.json();
      const assistantMessage = data.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');

      setChatMessages(prev => [...prev, { role: 'assistant', content: assistantMessage }]);

    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => [...prev, { 
        role: 'assistant', 
        content: '❌ Sorry, I encountered an error. Please try asking again.' 
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const downloadReport = () => {
    if (!report) return;

    const reportContent = `
# ${report.projectName} - Progress Report
**Date:** ${report.date}  
**Generated:** ${report.generatedAt}  
**Images Analyzed:** ${report.totalImages}

---

## Executive Summary

**Status:** ${report.summary.status.replace('_', ' ').toUpperCase()}

### Key Accomplishments
${report.summary.accomplishments.map(item => `- ${item}`).join('\n')}

### Areas Requiring Attention
${report.summary.concerns.map(item => `- ${item}`).join('\n')}

### Recommended Next Steps
${report.summary.nextSteps.map(item => `- ${item}`).join('\n')}

---

## Image Analysis

${images.map((img, idx) => `
### Image ${idx + 1}: ${img.title || 'Untitled'}

**Quality Status:** ${img.quality?.toUpperCase() || 'N/A'}

**Observations:**  
${img.observations || 'No observations'}

**Key Findings:**
${img.findings?.map(f => `- ${f}`).join('\n') || '- None'}

---
`).join('\n')}

## Report Generated by SnapReport AI
Automated visual progress reporting for construction and site management.
    `.trim();

    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.projectName.replace(/\s+/g, '_')}_Progress_Report_${report.date}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetApp = () => {
    setImages([]);
    setReport(null);
    setChatMessages([]);
    setProjectName('');
    setReportDate(new Date().toISOString().split('T')[0]);
  };

  const getQualityColor = (quality) => {
    switch(quality) {
      case 'good': return 'text-green-600 bg-green-50';
      case 'attention': return 'text-yellow-600 bg-yellow-50';
      case 'risk': return 'text-red-600 bg-red-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };


  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 p-2 rounded-lg">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">SnapReport AI</h1>
                <p className="text-sm text-slate-600">Visual Progress Reports + AI Assistant</p>
              </div>
            </div>

            
            <div className="flex items-center gap-3">
              {report && (
                <button
                  onClick={resetApp}
                  className="flex items-center gap-2 px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span className="hidden sm:inline">New Project</span>
                </button>
              )}
              <div className="text-right hidden md:block">
                <div className="text-sm font-medium text-slate-700">by Rukmer AI</div>
                <div className="text-xs text-slate-500">Construction Intelligence</div>
              </div>
            </div>
          </div>
        </div>
      </header>


      {/* Server Status */}

      <div className="p-10">
      <h1 className="text-3xl font-bold">Rukmer AI</h1>
      <p className="mt-4 text-gray-600">
        Server Status: {serverMessage || "Connecting..."}
      </p>
    </div>

      {/* Main Content - Split Layout */}
      <div className="max-w-[1800px] mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-6 h-[calc(100vh-140px)]">
          {/* Left Panel - Report/Upload */}
          <div className="flex flex-col gap-6 overflow-y-auto pr-2">
            {/* Project Info */}
            {!report && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4">Project Information</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Project Name
                    </label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="e.g., Downtown Office Tower"
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      Report Date
                    </label>
                    <input
                      type="date"
                      value={reportDate}
                      onChange={(e) => setReportDate(e.target.value)}
                      className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Upload Section */}
            {!report && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-900">Upload Site Images</h2>
                  <span className="text-sm text-slate-600">{images.length} images</span>
                </div>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full border-2 border-dashed border-slate-300 rounded-lg p-8 hover:border-blue-400 hover:bg-blue-50 transition-all group"
                >
                  <Upload className="w-12 h-12 mx-auto text-slate-400 group-hover:text-blue-500 mb-3" />
                  <div className="text-slate-600 group-hover:text-blue-600">
                    <span className="font-medium">Click to upload</span> or drag and drop
                  </div>
                  <div className="text-sm text-slate-500 mt-1">PNG, JPG, JPEG up to 10MB each</div>
                </button>

                {images.length > 0 && (
                  <div className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4">
                    {images.map(img => (
                      <div key={img.id} className="relative group">
                        <img
                          src={img.preview}
                          alt="Upload preview"
                          className="w-full h-32 object-cover rounded-lg border border-slate-200"
                        />
                        <button
                          onClick={() => removeImage(img.id)}
                          className="absolute top-2 right-2 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {images.length > 0 && !analyzing && (
                  <button
                    onClick={analyzeImages}
                    className="mt-6 w-full bg-gradient-to-r from-blue-500 to-blue-600 text-white py-3 px-6 rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-all shadow-lg shadow-blue-500/30"
                  >
                    <Sparkles className="w-5 h-5 inline mr-2" />
                    Generate AI Report
                  </button>
                )}

                {analyzing && (
                  <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center gap-3">
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                      <div>
                        <div className="font-medium text-blue-900">Analyzing images...</div>
                        <div className="text-sm text-blue-700">AI is examining your site photos</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Report Display */}
            {report && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">{report.projectName}</h2>
                      <div className="text-sm text-slate-600 mt-1">
                        {report.date} • {report.totalImages} images analyzed
                      </div>
                    </div>
                    <button
                      onClick={downloadReport}
                      className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                  </div>

                  <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${
                    report.summary.status === 'on_track' ? 'bg-green-100 text-green-700' :
                    report.summary.status === 'ahead' ? 'bg-blue-100 text-blue-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    Status: {report.summary.status.replace('_', ' ').toUpperCase()}
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Executive Summary</h3>
                  
                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium text-green-700 mb-2 flex items-center gap-2">
                        <Check className="w-4 h-4" />
                        Key Accomplishments
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-slate-700">
                        {report.summary.accomplishments.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>

                    {report.summary.concerns.length > 0 && (
                      <div>
                        <h4 className="font-medium text-yellow-700 mb-2 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4" />
                          Areas Requiring Attention
                        </h4>
                        <ul className="list-disc list-inside space-y-1 text-slate-700">
                          {report.summary.concerns.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <h4 className="font-medium text-blue-700 mb-2">Recommended Next Steps</h4>
                      <ul className="list-disc list-inside space-y-1 text-slate-700">
                        {report.summary.nextSteps.map((item, idx) => (
                          <li key={idx}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Detailed Analysis</h3>
                  
                  <div className="space-y-4">
                    {images.map((img, idx) => (
                      <div key={img.id} className="border border-slate-200 rounded-lg p-4">
                        <div className="flex gap-4">
                          <img
                            src={img.preview}
                            alt={img.title}
                            className="w-24 h-24 object-cover rounded-lg flex-shrink-0"
                          />
                          <div className="flex-1">
                            <div className="flex items-start justify-between mb-2">
                              <h4 className="font-semibold text-slate-900 text-sm">{img.title}</h4>
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${getQualityColor(img.quality)}`}>
                                {img.quality?.toUpperCase()}
                              </span>
                            </div>
                            <p className="text-xs text-slate-700 mb-2">{img.observations}</p>
                            {img.findings && img.findings.length > 0 && (
                              <ul className="text-xs text-slate-600 space-y-1">
                                {img.findings.slice(0, 2).map((finding, fidx) => (
                                  <li key={fidx} className="flex items-start gap-1">
                                    <span className="text-blue-500">•</span>
                                    <span>{finding}</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {images.length === 0 && !report && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-12 text-center">
                <Camera className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                <h3 className="text-xl font-semibold text-slate-900 mb-2">
                  Ready to Generate Your First Report?
                </h3>
                <p className="text-slate-600 mb-6 max-w-md mx-auto">
                  Upload construction site photos and let AI analyze progress, identify issues, and answer your questions.
                </p>
              </div>
            )}
          </div>

          {/* Right Panel - AI Chat */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col h-full">
            {/* Chat Header */}
            <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white p-4 rounded-t-xl">
              <div className="flex items-center gap-3">
                <div className="bg-white/20 p-2 rounded-lg">
                  <MessageCircle className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-lg">AI Assistant</div>
                  <div className="text-sm text-purple-100">Ask me anything about your project</div>
                </div>
                <div className="bg-white/20 px-3 py-1 rounded-full text-sm">
                  {chatMessages.filter(m => m.role === 'assistant').length} responses
                </div>
              </div>
            </div>

            {/* Chat Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
              {chatMessages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center max-w-md">
                    <MessageCircle className="w-16 h-16 mx-auto text-slate-300 mb-4" />
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">
                      Your AI Assistant is Ready
                    </h3>
                    <p className="text-slate-600 text-sm mb-4">
                      Upload images and generate a report to start asking questions about defects, measurements, safety concerns, and more.
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      <span className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-full">Defect Analysis</span>
                      <span className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-full">Measurements</span>
                      <span className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-full">Safety Checks</span>
                      <span className="text-xs bg-purple-100 text-purple-700 px-3 py-1 rounded-full">Recommendations</span>
                    </div>
                  </div>
                </div>
              )}

              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-4 ${
                    msg.role === 'user' 
                      ? 'bg-purple-600 text-white' 
                      : 'bg-white border border-slate-200 text-slate-900 shadow-sm'
                  }`}>
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                  </div>
                </div>
              ))}
              
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-5 h-5 text-purple-600 animate-spin" />
                      <span className="text-sm text-slate-600">AI is thinking...</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 bg-white border-t border-slate-200 rounded-b-xl">
              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  onClick={() => setChatInput("What are the main structural concerns?")}
                  className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  💡 Main concerns?
                </button>
                <button
                  onClick={() => setChatInput("Estimate the affected surface area")}
                  className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  📏 Surface area?
                </button>
                <button
                  onClick={() => setChatInput("What should we prioritize?")}
                  className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  🎯 Priority?
                </button>
                <button
                  onClick={() => setChatInput("Are there any safety hazards?")}
                  className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg hover:bg-slate-200 transition-colors"
                >
                  ⚠️ Safety check?
                </button>
              </div>
              
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && sendChatMessage()}
                  placeholder="Ask about defects, surface area, safety concerns..."
                  className="flex-1 px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  disabled={chatLoading || images.length === 0}
                />
                <button
                  onClick={sendChatMessage}
                  disabled={chatLoading || !chatInput.trim() || images.length === 0}
                  className="bg-purple-600 text-white px-6 py-3 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  <Send className="w-5 h-5" />
                  <span className="hidden sm:inline">Send</span>
                </button>
              </div>
              
              {images.length === 0 && (
                <p className="text-xs text-slate-500 mt-2 text-center">
                  Upload images to start chatting with AI
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}