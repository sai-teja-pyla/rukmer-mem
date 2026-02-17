import React, { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
    Upload, Loader2, X, Sparkles, MessageCircle, Send,
    FileVideo, FileText, Moon, Sun, CheckCircle2, AlertTriangle,
    SquarePen, Hexagon, Plus, FileStack, Edit2, Trash2, LayoutGrid,
    ImageIcon, Zap, ChevronDown, Search, Download
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

import UserDropdown from '../components/UserDropdown';
import PricingModal from '../components/PricingModal';
import { useUserSettings } from '../hooks/useUserSettings';

// FIREBASE IMPORTS
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { collection, addDoc, getDocs, getDoc, query, where, orderBy, serverTimestamp, doc, updateDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { storage, db } from "../firebase";

// --- NEW API SERVICE IMPORTS ---
import { sendChatMessage as saveToDB, fetchChatHistory } from '../services/api';

// Constant for the resumable API endpoint
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001/api';

export default function Dashboard({ user, isPro: globalIsPro }) {
    // --- 1. STATE ---
    const [searchParams, setSearchParams] = useSearchParams();
    const [mediaItems, setMediaItems] = useState([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0); // Tracking 5GB uploads

    const [report, setReport] = useState(null);
    const [reportId, setReportId] = useState(null);

    const [projectName, setProjectName] = useState('');
    const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);

    const [pastReports, setPastReports] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [reportIdToDelete, setReportIdToDelete] = useState(null);
    
    // NEW: Search state for reports sidebar
    const [searchQuery, setSearchQuery] = useState('');

    const [chatMessages, setChatMessages] = useState([]);
    const [chatInput, setChatInput] = useState('');
    const [chatLoading, setChatLoading] = useState(false);

    // Media Popup
    //const [showMediaModal, setShowMediaModal] = useState(false);

    const { settings, updateSettings } = useUserSettings();
    const darkMode = settings?.theme === 'dark';

    const fileInputRef = useRef(null);
    const chatEndRef = useRef(null);
    const chatSessionRef = useRef(null);

    // Model selection (VLRE 1.0)
    const [selectedEngine, setSelectedEngine] = useState('Auto'); // Default to Auto
    const [isEngineDropdownOpen, setIsEngineDropdownOpen] = useState(false);
    const engineDropdownRef = useRef(null);

    // --- SUBSCRIPTION LOGIC ---
    const [showPricing, setShowPricing] = useState(false);

    const isPro = globalIsPro;

    // For tracking monthly usage
    const [monthlyUsage, setMonthlyUsage] = useState(0);

    // --- 2. USAGE TRACKING LOGIC ---
    const checkMonthlyUsage = () => {
        if (!user || isPro) {
            setMonthlyUsage(0);
            return;
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const thisMonthReports = pastReports.filter(report => {
            const rDate = report.createdAt?.toDate ? report.createdAt.toDate() : new Date(report.date);
            return rDate >= startOfMonth;
        });

        setMonthlyUsage(thisMonthReports.length);
    };

    // --- SYSTEM DIAGNOSTIC ---
    const runSystemDiagnostic = async () => {
        const status = {
            api: { ok: false, msg: 'Checking...' },
            database: { ok: false, msg: 'Checking...' },
            storage: { ok: false, msg: 'Checking...' }
        };

        try {
            if (import.meta.env.VITE_GEMINI_API_KEY) {
                status.api = { ok: true, msg: 'Connected' };
            } else {
                throw new Error("API Key Missing");
            }

            if (db) {
                status.database = { ok: true, msg: 'Cloud Sync Active' };
            }

            if (storage) {
                status.storage = { ok: true, msg: 'Assets Ready' };
            }

            console.log("🛠️ Rukmer System Diagnostic:", status);
            return status;
        } catch (err) {
            console.error("🚨 Diagnostic Failure:", err);
            return { error: err.message };
        }
    };

    // --- REFINED: LOAD CHAT HISTORY WITHOUT CRASHING ---
    useEffect(() => {
        const loadCloudHistory = async () => {
            if (!user) return;
            try {
                console.log("📡 Fetching history for user:", user.uid);
                const history = await fetchChatHistory(user.uid);

                console.log("📥 Raw history from DB:", history);
                
                if (Array.isArray(history) && history.length > 0) {
                    const formattedHistory = history.flatMap(chat =>[
                        { 
                            role: 'user', 
                            content: chat.user_message || '...' 
                        },
                        { 
                            role: 'assistant', 
                            content: chat.ai_reply || '...', 
                            image: chat.image_url || null // Merged correctly to prevent UI crashes
                        }
                    ]);
                    console.log("✅ Setting messages to state:", formattedHistory);
                    setChatMessages(formattedHistory);
                } else {
                console.log("ℹ️ No active history found in DB.");
            }
            } catch (err) {
                console.error("No cloud history found or server offline", err);
            }
        };

        loadCloudHistory();
    }, [user]);

    useEffect(() => {
        if (user) {
            runSystemDiagnostic().then(res => {
                if (res.error) {
                    setChatMessages(prev => [...prev, {
                        role: 'assistant',
                        content: `⚠️ System Diagnostic: I detected a connection issue (${res.error}). Please check your internet or refresh.`
                    }]);
                }
            });
        }
    }, [user]);

    useEffect(() => {
        if (user) {
            fetchReports();
        }
    }, [user]);

    useEffect(() => {
        checkMonthlyUsage();
    }, [pastReports, isPro, user]);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [chatMessages]);

    useEffect(() => {
        function handleClickOutside(event) {
            if (engineDropdownRef.current && !engineDropdownRef.current.contains(event.target)) {
                setIsEngineDropdownOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // --- 3. RESTORE SESSION ---
    useEffect(() => {
        async function restoreSession() {
            const idFromUrl = searchParams.get('id');
            const shouldUpgrade = searchParams.get('upgrade') === 'true';

            if (idFromUrl && user) {
                loadReportById(idFromUrl);
            } else if (shouldUpgrade) {
                setShowPricing(true);
                setSearchParams({}); 
            } else if (searchParams.get('payment') === 'success') {
                setSearchParams({});
            }
        }
        restoreSession();
    }, [searchParams, user]);

    // --- 4. HELPER: LOAD REPORT & SHOW IMAGE IN CHAT ---
    const loadReportById = async (id) => {
        try {
            const docRef = doc(db, "reports", id);
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                
                let thumbnail = null;


                // 1. Restore Report Text Data
                setReportId(docSnap.id);
                setProjectName(data.projectName);
                setReport({
                    projectName: data.projectName,
                    date: data.date,
                    images: data.images || [],
                    summary: {
                        status: data.status,
                        accomplishments: data.accomplishments || [],
                        concerns: data.concerns || [],
                        nextSteps: data.nextSteps || []
                    }
                });

                // 2. Restore Media Items for Display
                if (data.images && Array.isArray(data.images)) {
                    const restoredMedia = data.images.map(img => ({
                        id: Math.random().toString(36).substr(2, 9),
                        preview: img.url, 
                        type: img.type || 'image',
                        name: img.name || 'restored-asset',
                        uploadStatus: 'done' 
                    }));
                    setMediaItems(restoredMedia);
                    
                    if (data.images.length > 0) {
                        thumbnail = data.images[0].url;
                    }
                } else {
                    setMediaItems([]);
                }

                setShowHistory(false);

                // 3. Initialize Chat Context
                const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
                const genAI = new GoogleGenerativeAI(apiKey);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                chatSessionRef.current = model.startChat({
                    history: [
                        { role: "user", parts: [{ text: `I am loading the report for "${data.projectName}". Please analyze the following context: Status: ${data.status}. Accomplishments: ${data.accomplishments.join(", ")}. Concerns: ${data.concerns.join(", ")}.` }] },
                        { role: "model", parts: [{ text: `Context for ${data.projectName} loaded successfully. I am ready to discuss the findings.` }] }
                    ]
                });

                const openNotice = `📂 **Opened Report:** ${data.projectName}`;

                const bulkGalleryMessage = {
                    role: 'assistant',
                    content: `📂 **Bulk Report Assets (${data.images.length} items):** Click any asset below to view full resolution.`,
                    gallery: data.images 
                };

                setChatMessages(prev => {
                    const lastMsg = prev[prev.length - 1];
                    const reportNotice = `📂 **Opened Report:** ${data.projectName}`;
                    if (lastMsg?.content === reportNotice) {
                        return prev; 
                    }
                    
                    return [
                        ...prev,
                        {
                            role: 'assistant',
                            content: `📂 **Opened Report:** ${data.projectName}`,
                            image: data.images?.[0]?.url || null,
                            gallery: data.images || []
                            //image: thumbnail 
                        }
                    ];
                });

                await saveToDB({
                    userId: user.uid,
                    reportId: docSnap.id,
                    message: `System: Open ${data.projectName}`,
                    aiResponse: openNotice,
                    imageUrl: thumbnail
                });

            } else {
                setSearchParams({});
            }           
        } catch (error) {
            console.error("Failed to load report:", error);
        }
    };


    // --- 5. DATABASE FUNCTIONS ---
    const handleRenameProject = async (newName) => {
        if (!reportId || !newName.trim()) return;
        try {
            const reportRef = doc(db, "reports", reportId);
            await updateDoc(reportRef, { projectName: newName });
            setReport(prev => ({ ...prev, projectName: newName }));
            setPastReports(prev =>
                prev.map(r => r.id === reportId ? { ...r, projectName: newName } : r)
            );
        } catch (error) {
            console.error("Error renaming:", error);
        }
    };

    const deleteReport = async (e, id) => {
        e.stopPropagation();
        if (!window.confirm("Are you sure you want to delete this report?")) return;

        try {
            await deleteDoc(doc(db, "reports", id));
            setPastReports(prev => prev.filter(r => r.id !== id));
            if (reportId === id) {
                resetApp();
            }
        } catch (error) {
            console.error("Error deleting report:", error);
            alert("Failed to delete report.");
        }
    };

    const saveReportToDB = async (aiResult, uploadedImages) => {
        try {
            if (!user) return;

            const docRef = await addDoc(collection(db, "reports"), {
                userId: user.uid,
                userName: user.name || "Anonymous",
                projectName: projectName || "Untitled Project",
                date: reportDate,
                createdAt: serverTimestamp(),
                status: aiResult.summary.status,
                accomplishments: aiResult.summary.accomplishments,
                concerns: aiResult.summary.concerns,
                images: uploadedImages,
                imageCount: uploadedImages.length
            });

            setReportId(docRef.id);
            setSearchParams({ id: docRef.id });
            fetchReports();
        } catch (error) {
            console.error("❌ Error saving report:", error);
        }
    };

    const fetchReports = async () => {
        if (!user) return;
        try {
            const q = query(
                collection(db, "reports"),
                where("userId", "==", user.uid),
                orderBy("createdAt", "desc")
            );
            const querySnapshot = await getDocs(q);
            const reports = querySnapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setPastReports(reports);
        } catch (error) {
            console.error("Error fetching reports:", error);
        }
    };


    // --- 6. HANDLERS ---

    // The file upload logic
const uploadLargeFile = async (file) => {
     if (!user) {
        console.error("No user found! Are you logged in?");
        return;
    }


    const baseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:5001').replace(/\/$/, '');
    const handshakeUrl = `${baseUrl}/api/storage/resumable-url`;

    console.log("📡 Attempting handshake at:", handshakeUrl);

    //const userNameToSend = user.displayName || user.email.split('@')[0];

    const response = await fetch(handshakeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            fileName: file.name, 
            contentType: file.type, 
            userId: user?.uid,
            userName: user?.displayName || user.email?.split('@')[0] || 'user'
        })
    });
    
    if (!response.ok) {
        const text = await response.text();
        console.error("🚨 Server responded with error:", text);
        throw new Error("Cloud handshake failed. Ensure backend route exists.");
    }

    const { uploadUrl, publicUrl } = await response.json();

    const startRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'x-goog-resumable': 'start',
            'Content-Type': file.type
        }
    });

    const sessionUrl = startRes.headers.get('Location');

    // 2. Binary Stream to Google
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sessionUrl);
        xhr.setRequestHeader('Content-Type', file.type);
        
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const percent = Math.round((e.loaded / e.total) * 100);
                setUploadProgress(percent === 100 ? 99 : percent);
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201) {
                setUploadProgress(100);
                resolve(publicUrl);
            } else {
                reject(`GCS rejection: ${xhr.status}`);
            }
        };
        xhr.onerror = () => reject('Network error');
        xhr.send(file);
    });
};



    const compressImage = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 1024;
                    let width = img.width;
                    let height = img.height;

                    if (width > MAX_WIDTH) {
                        height *= MAX_WIDTH / width;
                        width = MAX_WIDTH;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(dataUrl.split(',')[1]);
                };
            };
        });
    };

    const handleFileUpload = (e) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);

    if (mediaItems.length + files.length > 10) {
        alert("⚠️ Maximum limit reached: You can upload up to 10 files per project.");
        // Optional: Slice the incoming array to only fill the remaining spots
        // const allowedFiles = incomingFiles.slice(0, 10 - mediaItems.length);
        return; 
    }

    const newItems = files.map(file => {
        const id = Math.random().toString(36).substr(2, 9);
        const isVideo = file.type.startsWith('video/');
        
        // 1. If it's a video, start the frame capture process immediately
        if (isVideo) {
            const video = document.createElement('video');
            const videoUrl = URL.createObjectURL(file);
            video.src = videoUrl;
            video.muted = true;
            video.playsInline = true;

            video.onloadeddata = () => {
                video.currentTime = 1; // Skip the first second to avoid black frames
            };

            video.onseeked = () => {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                    const thumbnail = canvas.toDataURL('image/jpeg');
                    
                    // Update state safely using the functional update pattern
                    setMediaItems(prev => prev.map(item => 
                        item.id === id ? { ...item, preview: thumbnail } : item
                    ));
                }
                URL.revokeObjectURL(videoUrl);
            };
        }

        return {
            id,
            file,
            // Default: use the purple icon if it's a video until the frame is ready
            preview: isVideo ? null : URL.createObjectURL(file), 
            type: isVideo ? 'video' : 'image',
            name: file.name,
            uploadStatus: 'pending',
            uploadProgress: 0
        };
    });

    setMediaItems(prev => [...prev, ...newItems]);
};

    const removeMedia = (id) => {
        setMediaItems(prev => prev.filter(item => item.id !== id));
    };

    const analyzeSite = async () => {
        if (!isPro && monthlyUsage >= 5) {
            setShowPricing(true);
            return;
        }

        if (mediaItems.length === 0) return;
        setAnalyzing(true);
        setUploadProgress(0);

        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
            //if (!apiKey) throw new Error("API Key Missing");

            const genAI = new GoogleGenerativeAI(apiKey);
            const model = genAI.getGenerativeModel({
                model: "gemini-2.5-flash",
                generationConfig: { responseMimeType: "application/json" }
            });

            const mediaParts = await Promise.all(mediaItems.map(async (item) => {
                if (!item.file) return null;


                if (item.file) {
                    if (item.file.size > 50 * 1024 * 1024) {
                        const cloudUrl = await uploadLargeFile(item.file);
                        return { text: `[VIDEO_CONTEXT: ${cloudUrl}]` };
                    }

                    // For PDFs Documents (OCR)

                    if (item.file.type === 'application/pdf') {
                        return new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = () => resolve({
                                inlineData: {
                                    data: reader.result.split(',')[1],
                                    mimeType: 'application/pdf'
                                }
                            });
                            reader.readAsDataURL(item.file);
                        });
                    }


                    // For images
                    if (item.type === 'image') {
                        const compressed = await compressImage(item.file);
                        return { inlineData: { data: compressed, mimeType: 'image/jpeg' } };
                    }
                }
                return null;
            }));

            const validMediaParts = mediaParts.filter(p => p !== null);

            // SUCCESSFUL STREAM UPLOAD LOGIC
            const uploadedImages = await Promise.all(mediaItems.map(async (item) => {
                if (!item.file) return { url: item.preview, type: item.type, name: item.name };
                if (item.file.size > 50 * 1024 * 1024) return { url: item.preview, type: item.type, name: item.name, isLarge: true };
                
                const storageRef = ref(storage, `reports/${user.uid}/${Date.now()}_${item.name}`);
                await uploadBytes(storageRef, item.file);
                const url = await getDownloadURL(storageRef);
                return { url, type: item.type, name: item.name };
            }));

            const prompt = `Analyze these ${mediaItems.length} assets for construction progress. Return JSON: { "projectName": "${projectName || 'Untitled'}", "summary": { "status": "on_track", "accomplishments": [], "concerns": [], "nextSteps": [] } }`;

            const result = await model.generateContent([prompt, ...validMediaParts.filter(Boolean)]);
            const reportData = JSON.parse(result.response.text());

            setReport({
                projectName: reportData.projectName || projectName,
                date: reportDate,
                summary: reportData.summary
            });

            saveReportToDB(reportData, uploadedImages);

            const chatModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
            chatSessionRef.current = chatModel.startChat({
                history: [
                    { role: "user", parts: [{ text: `I have generated this report for "${reportData.projectName}". Please keep this in context.` }] },
                    { role: "model", parts: [{ text: "Context for the new report loaded. I am ready to answer questions." }] }
                ]
            });

            setChatMessages(prev => [...prev, { 
                role: 'assistant', 
                content: `Analysis Complete! Saved to history.`,
                image: uploadedImages.length > 0 ? uploadedImages[0].url : null 
            }]);

            try {
                const firstThumb = uploadedImages.length > 0 ? uploadedImages[0].url : null;
                const finalPName = reportData.projectName || projectName;
                await saveToDB({
                    userId: user.uid,
                    reportId: reportData.id || null, // Ensure you have the report ID here
                    message: `New Analysis: ${finalPName}`,
                    aiResponse: `📂 **Opened Report:** ${finalPName}`,
                    imageUrl: firstThumb
                });
                console.log("✅ Analysis record synced to Cloud SQL");
            } catch (dbErr) {
                console.error("❌ Failed to sync analysis to database:", dbErr);
            }

        } catch (error) {
            if (error.message.includes("429") || error.message.includes("Quota")) {
                alert("⚠️ AI Usage Limit Reached. Please wait a minute and try again.");
            } else {
                alert(`Error: ${error.message}`);
            }
            console.error(error);
        } finally {
            setAnalyzing(false);
            setUploadProgress(0);
        }
    };

    const handleCheckout = async (priceId) => {
        try {
            const { handleUpgrade } = await import('../lib/stripe');
            await handleUpgrade(user.uid, priceId);
        } catch (error) {
            console.error("Stripe Checkout Error:", error);
            alert("Failed to initiate checkout. Please try again.");
        }
    };


    // --- 7. AI AGENT LOGIC ---
    const sendChatMessage = async () => {
        if (!chatInput.trim() || chatLoading) return;

        const msg = chatInput;
        setChatInput('');
        setChatLoading(true);
        setChatMessages(prev => [...prev, { role: 'user', content: msg }]);

        try {
            const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
            const genAI = new GoogleGenerativeAI(apiKey);

            const modelMapping = {
                'Fast': 'gemini-2.5-flash-lite', 
                'Auto': 'gemini-2.5-flash',
                'Pro': 'gemini-2.5-pro'
            };
            const modelName = modelMapping[selectedEngine] || 'gemini-2.5-flash';

            // HIGH-FIDELITY DATA HARVESTING
            const reportData = report ? {
                projectName: report.projectName,
                status: report.summary.status,
                accomplishments: report.summary.accomplishments,
                concerns: report.summary.concerns,
                nextSteps: report.summary.nextSteps || []
            } : null;

            const systemInstruction = `
            You are Rukmer AI, an advanced enterprise intelligence analyst.
            Rukmer AI - Senior Construction, Real Estate, and Insurance Analyst
            Proprietary intelligence engine by Rukmer Inc.

            # OPERATING GUIDELINES
            - **Accuracy First**: Only report findings present in the [ACTIVE REPORT DATA]. 
            - **Analytical Tone**: Maintain a precise, corporate, and objective tone. Use engineering-appropriate language (e.g., "structural compromise," "mitigation strategy," "occupancy timeline").
            - **No Hallucinations**: If data is missing for a specific query, state: "The current report does not contain data on [X]. I recommend a follow-up site inspection."
            
            [CRITICAL CONTEXT: ACTIVE REPORT]
            ${report ? `Project: ${report.projectName}\nData: ${JSON.stringify(report.summary, null, 2)}` : "NO REPORT LOADED. DO NOT HALLUCINATE."}

            [DIRECTORY: OTHER PROJECTS]
            ${pastReports.map(r => `- ${r.projectName} (ID: ${r.id})`).join("\n")}

            [ANALYTICAL GUIDELINES]
            1. BE SPECIFIC: Use the exact details in the "concerns" and "accomplishments" lists to answer questions.
            2. NO DISCLAIMERS: Never say "I can only load reports" or "This is the extent of information." Provide expert analysis.
            3. AGENT ACTION: If a user asks to see/open a project in the Directory, reply ONLY with: [[LOAD:ID]].
            4. IDENTITY: You are Rukmer AI, engineered by Rukmer Inc.

            1. **QUERY ANALYSIS**: When asked a question, first parse the [ACTIVE REPORT] for relevant keywords.
            2. **DAMAGE ASSESSMENT**: If "damage" or "concerns" are mentioned, provide a severity rating (Low, Medium, High) based on the context provided in the report.
            3. **REPORT SWITCHING**: If the user mentions a project from the [DIRECTORY] that is NOT the active project, you MUST respond ONLY with the code: [[LOAD:ID]]. Do not add conversational filler.

            # EXAMPLES (Few-Shot Prompting)
            - USER: "What are the issues at the Vizag site?"
            - AI: "Forensic analysis of the Vizag report indicates two primary concerns: (1) Minor concrete scaling on the eastern pillar and (2) Electrical conduit moisture. Severity: Medium."

            - USER: "Show me the Mall Project."
            - AI: "[[LOAD:mall-project-id-123]]"

            - USER: "Is there any plumbing damage?"
            - AI: "The current project data does not contain plumbing inspection records. I recommend updating the report with MEP-specific assets."
            # ACTION PROTOCOLS
            - **Conversational Efficiency**: Do NOT repeat your status or list the directory unless the user explicitly asks "What reports do I have?" or asks a question about a report that isn't loaded.
            - **Direct Answers**: If a report is loaded, answer the user's question immediately without introductory filler like "Based on the report..."
            - **Switching**: If the user asks to open a project, respond ONLY with: [[LOAD:ID]].

            Identity: Rukmer AI. Switch reports using [[LOAD:ID]].
            `;

            const model = genAI.getGenerativeModel({
                model: modelName,
                systemInstruction: { role: "system", parts: [{ text: systemInstruction }] }
            });

            // 3. STABLE HISTORY: Always leading with 'user'
            let history = chatMessages.slice(-6).map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: typeof m.content === 'string' ? m.content : "User shared an asset." }]
            }));

            if (history.length > 0 && history[0].role !== 'user') {
                history = history.slice(1);
            }

            const chat = model.startChat({ history });
            const result = await chat.sendMessage(msg);
            const responseText = result.response.text();

            const isLoadCommand = responseText.includes('[[LOAD:');

           // --- SYNC WITH BACKEND (Cloud SQL) ---

            if (!responseText.includes('[[LOAD:')) {
                try {
                    await saveToDB({
                        userId: user.uid,
                        reportId: report?.id || null,
                        message: msg,
                        aiResponse: responseText,
                        imageUrl: null
                    });
                    console.log("✅ DB Sync Success. Saved Row ID:", result.id);
                } catch (dbErr) {
                    console.warn("DB Sync failed but AI responded:", dbErr);
                }
            } else {
                console.log("Skipping DB save for Agent Command to prevent crash on refresh.");
            }

            // 4. AGENT COMMAND HANDLER
            const loadMatch = responseText.match(/\[\[LOAD:(.*?)\]\]/);
            if (loadMatch) {
                const targetId = loadMatch[1].trim();
                const target = pastReports.find(r => r.id === targetId);
                if (target) {
                    setChatMessages(prev => [...prev, { role: 'assistant', content: `Accessing data for **${target.projectName}**...` }]);
                    await loadReportById(targetId);
                }
            } else {
                setChatMessages(prev => [...prev, { role: 'assistant', content: responseText }]);
            }
        } catch (error) {
            console.error("Chat Logic Error:", error);
            setChatMessages(prev => [...prev, { role: 'assistant', content: "Rukmer AI encountered a temporary connection issue." }]);
        } finally {
            setChatLoading(false);
        }
    };

    const downloadPDF = () => {
        if (!report || !report.summary) {
            alert("Please analyze a site or open a report first.");
            return;
        }

        try {
            const doc = new jsPDF();

            // --- Header Section ---
            doc.setFontSize(22);
            doc.setTextColor(124, 58, 237);  // Rukmer Purple
            doc.text("RUKMER AI - SITE ANALYSIS", 14, 22);
            
            doc.setFontSize(10);
            doc.setTextColor(100, 116, 139);
            doc.text(`Project: ${report.projectName || "Untitled"}`, 14, 30);
            doc.text(`Date: ${report.date || new Date().toLocaleDateString()}`, 14, 35);

            // --- Data Prep (Fixed Variable Names) ---

            const accList = (report.summary.accomplishments || []).join('\n• ');
            const conList = (report.summary.concerns || []).join('\n• ');
            const nxtList = (report.summary.nextSteps || []).join('\n• ');

            // --- MODERN AUTOTABLE CALL ---

            autoTable(doc, {
                startY: 45,
                head: [['SECTION', 'DETAILS']],
                body: [
                    ['STATUS', (report.summary.status || 'N/A').toUpperCase()],
                    ['ACCOMPLISHMENTS', accList ? `• ${accList}` : 'None listed'],
                    ['CONCERNS', conList ? `• ${conList}` : 'None listed'],
                    ['NEXT STEPS', nxtList ? `• ${nxtList}` : 'None listed']
                ],
                theme: 'grid',
                headStyles: { fillColor: [124, 58, 237] },
                styles: { fontSize: 10, cellPadding: 5, overflow: 'linebreak' },
                columnStyles: {
                    0: { cellWidth: 40, fontStyle: 'bold' },
                    1: { cellWidth: 'auto' }
                }
            });

            // Save the file

            doc.save(`${(report.projectName || 'Report').replace(/\s+/g, '_')}.pdf`);
        } catch (err) {
            console.error("PDF GENERATION FAILED:", err);
            alert(`Error: ${err.message}`);
        }
    };

    const handleSoftReset = async () => {
        setChatMessages([]);
        if (chatSessionRef.current) chatSessionRef.current = null;
        try {
            const response = await fetch(`${API_BASE_URL}/chat/hide`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' }
            });
            if (response.ok) console.log("✅ Database successfully hid the messages.");
        } catch (error) {
            console.error("❌ Failed to reach backend for reset:", error);
        }
    };

    const resetApp = () => {
        setMediaItems([]);
        setReport(null);
        setReportId(null);
        setProjectName('');
        setChatMessages([]);
        setShowHistory(false);
        setSearchParams({});
    };

    const theme = {
        bg: darkMode ? 'bg-black' : 'bg-[#f8fafc]',
        card: darkMode ? 'bg-[#111111] border-[#333]' : 'bg-white border-gray-200',
        header: darkMode ? 'bg-[#111111] border-[#333]' : 'bg-white border-gray-200',
        text: darkMode ? 'text-gray-100' : 'text-[#0f172a]',
        subText: darkMode ? 'text-gray-400' : 'text-[#64748b]',
        input: darkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-white border-gray-300 text-gray-900',
        chatUser: 'bg-[#7c3aed] text-white',
        chatAI: darkMode ? 'bg-[#1a1a1a] text-gray-200 border border-[#333]' : 'bg-[#f3f4f6] text-gray-800',
        border: darkMode ? 'border-[#333]' : 'border-gray-200',
        glow: darkMode ? 'shadow-[0_0_40px_-10px_rgba(124,58,237,0.3)]' : 'shadow-none'
    };

    const filteredReports = pastReports.filter(hist => 
        hist.projectName?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className={`min-h-screen transition-colors duration-300 ${theme.bg} ${theme.text}`}>

            {/* HEADER */}
            <header className={`${theme.header} border-b px-6 py-3 flex justify-between items-center sticky top-0 z-50`}>
                <div className="flex items-center gap-2">
                    {darkMode && <div className="w-2.5 h-2.5 rounded-full bg-[#22c55e] animate-pulse"></div>}
                    <h1 className="text-xl font-bold tracking-tight">RUKMER <span className="text-[#7c3aed]">AI</span></h1>
                </div>
                <div className="flex items-center gap-4">
                    {isPro ? (
                        <span className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-3 py-1 rounded-full text-[10px] font-bold shadow-lg flex items-center gap-1">
                            <Zap size={10} fill="white" /> PRO MEMBER
                        </span>
                    ) : (
                        <button
                            onClick={() => setShowPricing(true)}
                            className="text-xs font-bold text-[#7c3aed] hover:bg-[#7c3aed]/10 px-3 py-1.5 rounded-lg transition-colors border border-[#7c3aed]/20"
                        >
                            Upgrade Plan
                        </button>
                    )}
                    <button
                        onClick={() => updateSettings({ theme: darkMode ? 'light' : 'dark' })}
                        className={`p-2 rounded-full transition-colors ${darkMode ? 'bg-[#222] text-white' : 'bg-gray-100 text-slate-600'}`}
                    >
                        {darkMode ? <Sun size={18} className="text-yellow-400" /> : <Moon size={18} />}
                    </button>
                    <UserDropdown user={user} onUpgradeClick={() => setShowPricing(true)} isPro={isPro} />
                </div>
            </header>

            <div className="max-w-7xl mx-auto p-4 lg:p-8 grid lg:grid-cols-12 gap-6 h-[calc(100vh-80px)]">

                <div className="lg:col-span-5 flex flex-col h-full min-h-0 overflow-y-auto pr-2 custom-scrollbar flex-shrink-0">
                    <div className="mb-6 space-y-1">
                        <button
                            onClick={() => { setShowHistory(false); if (report) resetApp(); }}
                            className={`w-full flex items-center justify-between p-3.5 rounded-xl transition-all group ${!showHistory && !report ? (darkMode ? 'bg-[#222] text-white' : 'bg-white shadow-sm border border-gray-200 text-gray-900') : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-[#222]'
                                }`}
                        >
                            <div className="flex items-center gap-3 font-semibold">
                                <SquarePen size={20} className={(!showHistory && !report) ? "text-[#7c3aed]" : "text-gray-400"} />
                                <span>New Chat</span>
                            </div>
                            <Plus size={18} className="text-gray-400 group-hover:text-gray-600" />
                        </button>

                        <button className="w-full flex items-center gap-3 p-3.5 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-[#222] transition-all font-semibold opacity-60 cursor-not-allowed">
                            <LayoutGrid size={20} />
                            <span>More Models</span>
                            <span className="ml-auto text-[10px] bg-gray-100 dark:bg-[#333] px-2 py-0.5 rounded-full">SOON</span>
                        </button>

                        <button
                            onClick={() => setShowHistory(true)}
                            className={`w-full flex items-center gap-3 p-3.5 rounded-xl transition-all font-semibold ${showHistory ? (darkMode ? 'bg-[#222] text-white' : 'bg-white shadow-sm border border-gray-200 text-gray-900') : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-[#222]'
                                }`}
                        >
                            <Hexagon size={20} className={showHistory ? "text-[#7c3aed]" : "text-gray-400"} />
                            <span>Asset Reports</span>
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto">
                        {showHistory ? (
                            <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                                
                                <div className="px-1 mb-4 sticky top-0 z-10">
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                        <input 
                                            type="text" 
                                            placeholder="Search projects..." 
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className={`w-full pl-9 pr-4 py-2 rounded-lg text-sm outline-none border transition-all ${theme.input}`}
                                        />
                                    </div>
                                </div>

                                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Recent Reports</h3>
                                
                                {filteredReports.map(hist => (
                                    <div
                                        key={hist.id}
                                        onClick={() => setSearchParams({ id: hist.id })}
                                        className={`p-4 rounded-xl cursor-pointer transition-all duration-200 relative overflow-hidden group 
                                    ${theme.card} border border-transparent
                                    ${darkMode
                                                ? 'hover:bg-[#1a1a1a] hover:border-[#7c3aed]/50 hover:shadow-[0_0_20px_-10px_rgba(124,58,237,0.3)]'
                                                : 'hover:bg-gray-50 hover:border-[#7c3aed] hover:shadow-md'
                                            }`}
                                    >
                                        <div className="flex justify-between items-start mb-1">
                                            <h3 className="font-bold truncate pr-4 flex-1">{hist.projectName}</h3>
                                            <span className={`flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${hist.status === 'on_track' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                                }`}>
                                                {hist.status?.replace('_', ' ')}
                                            </span>
                                        </div>

                                        <div className="flex justify-between items-end mt-4">
                                            <div className="text-[11px] text-gray-400 space-y-1">
                                                <p>{hist.date}</p>
                                                <span className="flex items-center gap-1.5"><FileStack size={12} /> {hist.imageCount || 0} Assets</span>
                                            </div>
                                            <div className="opacity-0 group-hover:opacity-100 transition-all duration-200">
                                                <button
                                                    onClick={(e) => deleteReport(e, hist.id)}
                                                    className="p-1.5 rounded-md text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                                                >
                                                    <Trash2 size={15} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {filteredReports.length === 0 && <p className="text-center text-xs text-gray-500 mt-10">No projects found matching "{searchQuery}"</p>}
                            </div>
                        ) : (
                            <>
                                {!report ? (
                                    <div className={`${theme.card} p-8 rounded-2xl shadow-sm border text-center transition-all duration-300 animate-in fade-in`}>
                                        <div className="mb-6 flex justify-center">
                                            <div className={`w-16 h-16 rounded-full flex items-center justify-center ${darkMode ? 'bg-[#222]' : 'bg-[#f3e8ff]'}`}>
                                                <Upload className={darkMode ? 'text-[#a78bfa]' : 'text-[#7c3aed]'} size={32} />
                                            </div>
                                        </div>
                                        <h2 className="text-2xl font-bold mb-2">New Analysis</h2>
                                        <p className={`${theme.subText} mb-8`}>Upload photos, videos & documents.</p>
                                        <input
                                            type="text"
                                            placeholder="Project Name"
                                            className={`w-full p-3 rounded-xl mb-4 outline-none border transition-all ${theme.input}`}
                                            value={projectName}
                                            onChange={(e) => setProjectName(e.target.value)}
                                        />
                                        <input ref={fileInputRef} type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={handleFileUpload} />

                                        {mediaItems.length === 0 ? (
                                            <button onClick={() => fileInputRef.current?.click()} className={`w-full py-10 border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 hover:opacity-80 transition ${theme.border} ${theme.subText}`}>
                                                <span className="font-semibold">Click to browse files</span>
                                            </button>
                                        ) : (
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-4 gap-2 mb-4">
                                                    {mediaItems.map((item) => (
                                                        <div key={item.id} className="relative aspect-square rounded-lg overflow-hidden border border-gray-200 bg-black/10 flex items-center justify-center">
                                                            {item.preview ? (
                                                                <img
                                                                src={item.preview}
                                                                className="w-full h-full object-cover"
                                                                alt="preview"
                                                                />
                                                            ) : (
                                                            <div className="flex flex-col items-center justify-center w-full h-full bg-[#1a1a1a]">
                                                                <Loader2 className="animate-spin text-[#7c3aed]" size={20} />
                                                                </div>
                                                            )}
                                                            <button
                                                            onClick={() => removeMedia(item.id)}
                                                            className="absolute top-1 right-1 bg-red-500 p-1 rounded-full text-white shadow-lg z-10 hover:bg-red-600 transition-colors"
                                                            >
                                                                <X size={10} />
                                                                </button>
                                                                </div>
                                                            ))}
                                                            
                                                            {mediaItems.length > 0 && mediaItems.length < 10 && (
                                                                <div className="flex flex-col gap-1">
                                                                <button
                                                                onClick={() => fileInputRef.current?.click()}
                                                                className="relative aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-[#333] flex flex-col items-center justify-center gap-1 hover:border-[#7c3aed] hover:bg-[#7c3aed]/5 transition-all group"
                                                                >
                                                                    <Plus size={20} className="text-gray-400 group-hover:text-[#7c3aed]" />
                                                                    <span className="text-[10px] font-bold text-gray-400 group-hover:text-[#7c3aed]">ADD</span>
                                                                    </button>
                                                                    <span className="text-[9px] text-center text-gray-500 font-medium">
                                                                        {10 - mediaItems.length} slots left
                                                                        </span>
                                                                        </div>
                                                                )}
                                                            </div>

                                                {/* Upload Progress Bar */}
                                                {analyzing && uploadProgress > 0 && uploadProgress < 100 && (
                                                    <div className="mb-4 px-2">
                                                        <div className="flex justify-between text-[10px] mb-1 font-bold">
                                                           {/* <span>Committing to Google Cloud...</span> */}
                                                            <span>{uploadProgress}%</span>
                                                        </div>
                                                        <div className="w-full bg-gray-200 dark:bg-[#333] rounded-full h-2 shadow-inner overflow-hidden">
                                                            <div 
                                                                className="bg-gradient-to-r from-[#7c3aed] to-[#2563eb] h-full transition-all duration-500 ease-out" 
                                                                style={{ width: `${uploadProgress}%` }}
                                                            ></div>
                                                        </div>
                                                    </div>
                                                )}

                                                {!isPro && monthlyUsage >= 5 ? (
                                                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-center">
                                                        <p className="text-sm font-medium text-amber-800 dark:text-amber-400 mb-3">
                                                            ⚠️ Monthly limit reached (5/5 reports)
                                                        </p>
                                                        <button
                                                            onClick={() => setShowPricing(true)}
                                                            className="w-full bg-gradient-to-r from-[#7c3aed] to-[#2563eb] text-white py-2.5 rounded-lg font-bold shadow-md hover:opacity-90 transition"
                                                        >
                                                            Upgrade to Pro for Unlimited Reports
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={analyzeSite}
                                                        disabled={analyzing}
                                                        className="w-full bg-[#7c3aed] hover:bg-[#6d28d9] text-white py-3.5 rounded-xl font-bold transition flex justify-center items-center gap-2 shadow-lg"
                                                    >
                                                        {analyzing ? (
                                                            <>
                                                                <Loader2 className="animate-spin" size={18} />
                                                                <span>{uploadProgress > 0 ? `Uploading (${uploadProgress}%)` : 'Processing...'}</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Sparkles size={18} />
                                                                {isPro ? "Generate Pro Report" : `Generate Report (${5 - monthlyUsage} left)`}
                                                            </>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className={`${theme.card} p-6 rounded-2xl shadow-sm border animate-in fade-in slide-in-from-bottom-4`}>
                                        <div className="flex justify-between items-start mb-6">
                                            <div className="flex-1 mr-4">
                                                <div className="flex items-center gap-2 mb-1 group">
                                                    <input
                                                        value={projectName}
                                                        onChange={(e) => setProjectName(e.target.value)}
                                                        onBlur={() => handleRenameProject(projectName)}
                                                        className={`text-xl font-bold bg-transparent outline-none border-b border-transparent focus:border-[#7c3aed] transition-colors w-full ${theme.text}`}
                                                    />
                                                    <Edit2 size={14} className="text-gray-400 opacity-0 group-hover:opacity-100" />
                                                </div>
                                                <p className={`text-sm ${theme.subText}`}>{report.date}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={downloadPDF} className={`p-2 rounded-lg border hover:bg-gray-50/10 transition ${theme.border}`}><Download size={18} /></button>
                                            </div>
                                        </div>
                                        <div className={`p-3 rounded-lg mb-6 border ${report.summary.status === 'on_track' ? 'bg-green-500/10 text-green-600 border-green-500/20' :
                                            'bg-red-500/10 text-red-600 border-red-500/20'
                                            }`}>
                                            <div className="flex items-center gap-2 font-bold text-lg">
                                                {report.summary.status === 'on_track' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
                                                {report.summary.status?.replace('_', ' ').toUpperCase()}
                                            </div>
                                        </div>
                                        <div className="space-y-6">
                                            <div><h3 className="font-semibold mb-2 text-[#7c3aed]">Accomplishments</h3><ul className={`list-disc pl-5 text-sm ${theme.subText}`}>{report.summary.accomplishments.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                                            <div><h3 className="font-semibold mb-2 text-red-500">Concerns</h3><ul className={`list-disc pl-5 text-sm ${theme.subText}`}>{report.summary.concerns.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="lg:col-span-7 h-full flex flex-col min-h-0">
                    <div className={`${theme.card} flex-1 rounded-2xl border overflow-hidden flex flex-col ${theme.glow}`}>
                        <div className={`p-4 border-b ${theme.border} ${darkMode ? 'bg-[#111]' : 'bg-[#7c3aed] text-white'} flex items-center justify-between flex-shrink-0`}>
                            <div className="flex items-center gap-3">
                                <div className={`p-2 rounded-lg ${darkMode ? 'bg-[#222]' : 'bg-white/20'}`}>
                                    <MessageCircle className={darkMode ? "text-[#7c3aed]" : "text-white"} size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold">{darkMode ? "Rukmer AI" : "AI Assistant"}</h3>
                                    <p className={`text-xs ${darkMode ? 'text-gray-400' : 'text-purple-100'}`}>
                                        {report ? "Context Loaded" : "Ready to chat"}
                                    </p>
                                </div>
                            </div>
                            
                            <button
                                onClick={handleSoftReset}
                                className={`p-2 rounded-lg transition-colors flex items-center gap-2 text-xs font-bold ${
                                    darkMode
                                    ? 'hover:bg-[#222] text-gray-400 hover:text-white'
                                    : 'hover:bg-white/10 text-white'
                                }`}
                                title="Start New Conversation"
                            >
                                <Plus size={16} />
                                <span className="hidden sm:inline">Clear View</span>
                            </button>
                        </div>

                        <div className={`flex-1 overflow-y-auto p-6 space-y-6 ${darkMode ? 'bg-black' : 'bg-slate-50'}`}>
                            {chatMessages.length === 0 ? (
                                <div className="h-full flex flex-col items-center justify-center text-center opacity-60">
                                    <MessageCircle size={48} className="mb-4 text-[#7c3aed]" />
                                    <h3 className="text-lg font-medium">Assistant Ready</h3>
                                </div>
                            ) : (
                                chatMessages.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                                        <div className={`max-w-[85%] p-4 rounded-2xl ${msg.role === 'user' ? theme.chatUser : theme.chatAI}`}>
                                            
                                            {msg.gallery && msg.gallery.length > 0 ? (
                                                <div className="grid grid-cols-2 gap-2 mb-3">
                                                    {msg.gallery.map((asset, idx) => (
                                                        <div 
                                                        key={idx} 
                                                        className="relative aspect-square rounded-xl overflow-hidden border border-white/10 bg-[#111] cursor-pointer hover:opacity-80 transition-opacity group"
                                                        onClick={() => window.open(asset.url, '_blank')}
                                                        >
                                                            <img 
                                                            src={asset.url}
                                                            alt={`Asset ${idx + 1}`}
                                                            className="w-full h-full object-cover" 
                                                            />
                                                            
                                                            {asset.type === 'video' && (
                                                                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                                                    <FileVideo size={20} className="text-white drop-shadow-lg" />
                                                                    </div>
                                                                )}
                                                                <div className="absolute bottom-0 inset-x-0 p-1.5 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                <p className="text-[8px] text-white truncate text-center uppercase font-bold">
                                                                    {asset.name || `Asset ${idx + 1}`}
                                                                    </p>
                                                                    </div>
                                                                    </div>
                                                                ))}
                                                                </div>
                                                                ) : (
                                                                    
                                                                    msg.image && (
                                                                    <div className="mb-3 rounded-xl overflow-hidden border border-white/10 shadow-lg bg-[#111] min-h-[120px] flex flex-col items-center justify-center">
                                                                        {msg.image.toLowerCase().match(/\.(mp4|webm|ogg|mov|m4v)/) || msg.image.includes('video') ? (
                                                                            <div
                                                                            className="w-full p-6 flex flex-col items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors"
                                                                            onClick={() => window.open(msg.image, '_blank')}
                                                                            >
                                                                                <div className="p-4 bg-[#7c3aed]/20 rounded-full">
                                                                                <FileVideo className="text-[#7c3aed]" size={32} />
                                                                                </div>
                                                                                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                                                                                    Video Asset<br/>
                                                                                    <span className="text-[#7c3aed]">Click to Play</span>
                                                                                    </span>
                                                                                    </div>
                                                                                    ) : msg.image.toLowerCase().includes('.pdf') ? (
                                                                                    <div
                                                                                    className="w-full p-6 flex flex-col items-center gap-3 cursor-pointer hover:bg-white/5 transition-colors"
                                                                                    onClick={() => window.open(msg.image, '_blank')}
                                                                                    >
                                                                                        <div className="p-4 bg-red-500/20 rounded-full">
                                                                                        <FileText className="text-red-500" size={32} />
                                                                                        </div>
                                                                                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">
                                                                                            Document Asset<br/>
                                                                                            <span className="text-red-500">Click to View</span>
                                                                                            </span>
                                                                                            </div>
                                                                                            ) : (
                                                                                            <img
                                                                                            src={msg.image}
                                                                                            alt="Report Content"
                                                                                            className="w-full h-auto max-h-64 object-cover"
                                                                                            onError={(e) => {
                                                                                                e.target.style.display = 'none';
                                                                                                e.target.parentNode.innerHTML = `
                                                                                                <div class="p-6 flex flex-col items-center gap-2">
                                                                                                <div class="p-3 bg-gray-500/20 rounded-full">
                                                                                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-400"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                                                                                                </div>
                                                                                                <span class="text-[9px] font-bold text-gray-500 uppercase">Asset Preview</span>
                                                                                                </div>
                                                                                                `;
                                                                                            }}
                                                                                        />
                                                                                    )}
                                                                                </div>
                                                                            )
                                                                        )}
                                                                    {msg.content && msg.content.toString().split('\n').map((line, idx) => (
                                                                        <p key={idx} className="mb-1 text-sm">{line}</p>
                                                                        ))}
                                                                        </div>
                                                                    </div>
                                ))
                            )}
                            {chatLoading && <div className="flex justify-start items-center gap-3"><Loader2 className="animate-spin text-[#7c3aed]" size={16} /> <span className="text-sm">Processing...</span></div>}
                            <div ref={chatEndRef} />
                        </div>

                        <div className={`p-4 border-t ${theme.border} ${darkMode ? 'bg-[#111]' : 'bg-white'} flex-shrink-0`}>
                            <div className="relative mb-3 inline-block" ref={engineDropdownRef}>
                                <button
                                    onClick={() => setIsEngineDropdownOpen(!isEngineDropdownOpen)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all ${darkMode ? 'text-gray-400 hover:bg-[#222]' : 'text-gray-600 hover:bg-gray-100'
                                        }`}
                                >
                                    <span>VLRE 1.0 {selectedEngine}</span>
                                    <ChevronDown size={14} className={`transition-transform duration-200 ${isEngineDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>

                                {isEngineDropdownOpen && (
                                    <div className={`absolute bottom-full left-0 mb-2 w-48 rounded-xl border shadow-xl z-50 overflow-hidden ${darkMode ? 'bg-[#1a1a1a] border-[#333]' : 'bg-white border-gray-200'
                                        }`}>
                                        {[
                                            { id: 'Fast', label: 'VLRE 1.0 Fast', icon: <Zap size={14} className="text-blue-500" /> },
                                            { id: 'Auto', label: 'VLRE 1.0 Auto', icon: <Sparkles size={14} className="text-[#7c3aed]" /> },
                                            { id: 'Pro', label: 'VLRE 1.0 Pro', icon: <Zap size={14} className="text-yellow-500 fill-yellow-500" />, premium: true }
                                        ].map((engine) => (
                                            <button
                                                key={engine.id}
                                                onClick={() => {
                                                    if (engine.premium && !isPro) {
                                                        setShowPricing(true);
                                                    } else {
                                                        setSelectedEngine(engine.id);
                                                    }
                                                    setIsEngineDropdownOpen(false);
                                                }}
                                                className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${selectedEngine === engine.id
                                                    ? 'bg-[#7c3aed]/10 text-[#7c3aed] font-bold'
                                                    : `${darkMode ? 'text-gray-400 hover:bg-[#222]' : 'text-gray-600 hover:bg-gray-50'}`
                                                    }`}
                                            >
                                                <div className="flex items-center gap-3">
                                                    {engine.icon}
                                                    <span>{engine.label}</span>
                                                </div>
                                                {engine.premium && !isPro && <Zap size={12} className="text-yellow-500 fill-yellow-500" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="relative flex items-center">
                                <input
                                    className={`w-full pl-4 pr-12 py-3.5 rounded-xl outline-none transition-all shadow-sm ${theme.input}`}
                                    placeholder={`Ask Rukmer ${selectedEngine}...`}
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && sendChatMessage()}
                                    disabled={chatLoading}
                                />
                                <button onClick={() => sendChatMessage()} disabled={chatLoading} className="absolute right-2 p-2 rounded-lg bg-[#7c3aed] text-white">
                                    <Send size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {showPricing && (
                <PricingModal
                    isOpen={showPricing}
                    onClose={() => setShowPricing(false)}
                    onCheckout={handleCheckout}
                />
            )}
        </div>
    );
}