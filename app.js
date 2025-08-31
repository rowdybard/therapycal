// Main application logic
import { db, auth, onAuthStateChanged } from './firebase-config.js';
import { aiAssistant, voiceAssistant } from './ai-assistant.js';
import { 
    collection, 
    addDoc, 
    updateDoc, 
    deleteDoc, 
    doc, 
    getDocs, 
    onSnapshot,
    query,
    orderBy,
    where,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js';

// Application state
let calendar;
let clients = [];
let appointments = [];
let providers = [];
let undoStack = [];
let currentUser = null;
let isDarkMode = false;
let isPrivacyMode = false;
let currentSettings = {
    workStartTime: '09:00',
    workEndTime: '22:00',
    defaultDuration: 50,
    workingDays: [0, 1, 2, 3, 4, 5, 6], // All 7 days (Sunday=0 to Saturday=6)
    reminderTime: 24, // hours before appointment
    autoReminders: true
};

// Ensure we only initialize Firestore listeners once (after auth)
let dataListenersInitialized = false;

// Backend API configuration (Render Web Service)
const API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL) ? window.API_BASE_URL : null;
const useApiBackend = false; // Disabled - using Firebase Firestore instead

// API helpers
async function getAuthHeader() {
    if (!auth || !auth.currentUser) throw new Error('Not authenticated');
    const token = await auth.currentUser.getIdToken();
    return { 'Authorization': `Bearer ${token}` };
}

async function apiRequest(path, options = {}) {
    const headers = options.headers || {};
    const authHeader = await getAuthHeader();
    const resp = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...authHeader,
            ...headers
        }
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`API ${resp.status}: ${text || resp.statusText}`);
    }
    if (resp.status === 204) return null;
    return await resp.json();
}

async function apiGet(path) { return apiRequest(path, { method: 'GET' }); }
async function apiPost(path, body) { return apiRequest(path, { method: 'POST', body: JSON.stringify(body) }); }
async function apiPut(path, body) { return apiRequest(path, { method: 'PUT', body: JSON.stringify(body) }); }
async function apiDelete(path) { return apiRequest(path, { method: 'DELETE' }); }

async function loadDataFromApi() {
    try {
        showLoading();
        const [clientsRes, providersRes, appointmentsRes] = await Promise.all([
            apiGet('/api/clients'),
            apiGet('/api/providers'),
            apiGet('/api/appointments')
        ]);

        clients = (clientsRes || []).map(c => ({
            ...c,
            createdAt: c.createdAt ? new Date(c.createdAt) : undefined,
            updatedAt: c.updatedAt ? new Date(c.updatedAt) : undefined
        }));

        providers = (providersRes || []).map(p => ({
            ...p,
            createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
            updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined
        }));

        appointments = (appointmentsRes || []).map(a => ({
            ...a,
            start: a.start ? new Date(a.start) : undefined,
            end: a.end ? new Date(a.end) : undefined,
            createdAt: a.createdAt ? new Date(a.createdAt) : undefined,
            updatedAt: a.updatedAt ? new Date(a.updatedAt) : undefined
        }));

        renderClientList();
        updateClientFilter();
        updateAppointmentClientOptions();
        renderProvidersList && renderProvidersList();
        updateAppointmentProviderOptions();
        renderCalendarEvents();
        updateWeeklySummary();
    } finally {
        hideLoading();
    }
}

// DOM elements
const elements = {
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    menuToggleBtn: document.getElementById('menu-toggle-btn'),
    clientList: document.getElementById('client-list'),
    clientFilter: document.getElementById('client-filter'),
    weeklySummary: document.getElementById('weekly-summary'),
    loadingOverlay: document.getElementById('loading-overlay'),
    
    // Modals
    clientModal: document.getElementById('client-modal'),
    appointmentModal: document.getElementById('appointment-modal'),
    settingsModal: document.getElementById('settings-modal'),
    
    // Forms
    clientForm: document.getElementById('client-form'),
    appointmentForm: document.getElementById('appointment-form'),
    
    // Buttons
    addClientBtn: document.getElementById('add-client-btn'),
    newAppointmentBtn: document.getElementById('new-appointment-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    todayBtn: document.getElementById('today-btn'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    analyticsBtn: document.getElementById('analytics-btn'),
    providersBtn: document.getElementById('providers-btn'),
    voiceAssistantBtn: document.getElementById('voice-assistant-btn'),
    continueConversationBtn: document.getElementById('continue-conversation-btn')
};

// Utility functions
function showLoading() {
    elements.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    elements.loadingOverlay.classList.add('hidden');
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 100);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => document.body.removeChild(toast), 300);
    }, 3000);
}

// Dark Mode Functions
function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    localStorage.setItem('darkMode', isDarkMode);
    updateDarkModeUI();
}

function updateDarkModeUI() {
    const html = document.documentElement;
    const darkModeBtn = document.getElementById('dark-mode-btn');
    
    if (isDarkMode) {
        html.classList.add('dark');
        if (darkModeBtn) {
            darkModeBtn.querySelector('.material-icons').textContent = 'light_mode';
            darkModeBtn.title = 'Switch to Light Mode';
        }
    } else {
        html.classList.remove('dark');
        if (darkModeBtn) {
            darkModeBtn.querySelector('.material-icons').textContent = 'dark_mode';
            darkModeBtn.title = 'Switch to Dark Mode';
        }
    }
    
    // Refresh calendar to apply theme changes
    if (calendar) {
        renderCalendarEvents();
    }
}

// Privacy Mode Functions
function togglePrivacyMode() {
    isPrivacyMode = !isPrivacyMode;
    localStorage.setItem('privacyMode', isPrivacyMode);
    updatePrivacyModeUI();
    
    // Refresh calendar to apply privacy changes
    if (calendar) {
        renderCalendarEvents();
    }
}

function updatePrivacyModeUI() {
    const privacyBtn = document.getElementById('privacy-btn');
    
    if (isPrivacyMode) {
        if (privacyBtn) {
            privacyBtn.querySelector('.material-icons').textContent = 'visibility_off';
            privacyBtn.title = 'Show Client Names';
            privacyBtn.classList.add('bg-red-200', 'text-red-700');
            privacyBtn.classList.remove('bg-gray-200', 'text-gray-600');
        }
        showToast('Privacy mode enabled - client names hidden', 'success');
    } else {
        if (privacyBtn) {
            privacyBtn.querySelector('.material-icons').textContent = 'visibility';
            privacyBtn.title = 'Hide Client Names';
            privacyBtn.classList.add('bg-gray-200', 'text-gray-600');
            privacyBtn.classList.remove('bg-red-200', 'text-red-700');
        }
        showToast('Privacy mode disabled - client names visible', 'success');
    }
}

// Sidebar Toggle Functions
let isSidebarHidden = false;

function toggleSidebar() {
    isSidebarHidden = !isSidebarHidden;
    localStorage.setItem('sidebarHidden', isSidebarHidden);
    updateSidebarUI();
}

function updateSidebarUI() {
    const sidebar = document.getElementById('sidebar');
    const toggleBtn = document.getElementById('toggle-sidebar-btn');
    const mainApp = document.getElementById('main-app');
    
    if (isSidebarHidden) {
        if (sidebar) {
            sidebar.style.display = 'none';
        }
        if (toggleBtn) {
            toggleBtn.querySelector('.material-icons').textContent = 'visibility';
            toggleBtn.title = 'Show Client List';
            
            // Move button to main header when sidebar is hidden
            const headerDiv = document.querySelector('header .flex.items-center.space-x-2');
            if (headerDiv && !headerDiv.contains(toggleBtn)) {
                // Create a clone and add to header
                const headerToggleBtn = toggleBtn.cloneNode(true);
                headerToggleBtn.id = 'header-toggle-sidebar-btn';
                headerToggleBtn.className = 'px-3 py-1.5 text-gray-600 bg-gray-200 rounded-md hover:bg-gray-300 transition-colors duration-200';
                headerToggleBtn.addEventListener('click', toggleSidebar);
                headerDiv.insertBefore(headerToggleBtn, headerDiv.firstChild);
            }
        }
        showToast('Client list hidden', 'success');
    } else {
        if (sidebar) {
            sidebar.style.display = 'block';
        }
        if (toggleBtn) {
            toggleBtn.querySelector('.material-icons').textContent = 'visibility_off';
            toggleBtn.title = 'Hide Client List';
        }
        
        // Remove button from header if it exists
        const headerToggleBtn = document.getElementById('header-toggle-sidebar-btn');
        if (headerToggleBtn) {
            headerToggleBtn.remove();
        }
        
        showToast('Client list visible', 'success');
    }
}

function initializeModes() {
    // Load dark mode preference
    const savedDarkMode = localStorage.getItem('darkMode');
    if (savedDarkMode !== null) {
        isDarkMode = savedDarkMode === 'true';
        updateDarkModeUI();
    }
    
    // Load privacy mode preference
    const savedPrivacyMode = localStorage.getItem('privacyMode');
    if (savedPrivacyMode !== null) {
        isPrivacyMode = savedPrivacyMode === 'true';
        updatePrivacyModeUI();
    }
    
    // Load sidebar visibility preference
    const savedSidebarHidden = localStorage.getItem('sidebarHidden');
    if (savedSidebarHidden !== null) {
        isSidebarHidden = savedSidebarHidden === 'true';
        updateSidebarUI();
    }
}

function getDisplayName(clientName) {
    if (isPrivacyMode) {
        return '•••';
    }
    return clientName;
}

function formatDateTime(date) {
    const d = new Date(date);
    // Convert to local timezone for datetime-local input
    const offset = d.getTimezoneOffset();
    const localDate = new Date(d.getTime() - (offset * 60000));
    return localDate.toISOString().slice(0, 16);
}

function parseDateTime(dateTimeString) {
    return new Date(dateTimeString);
}

// Removed undo functionality as it doesn't work properly with Firebase real-time updates

// Overlap checking utility function for drag and resize operations
function checkForOverlaps(startTime, endTime, excludeAppointmentId = null) {
    return appointments.filter(appointment => {
        // Skip the appointment being moved/resized
        if (appointment.id === excludeAppointmentId) return false;
        
        // Check if the times overlap
        const aptStart = new Date(appointment.start);
        const aptEnd = new Date(appointment.end);
        const newStart = new Date(startTime);
        const newEnd = new Date(endTime);
        
        // Two appointments overlap if one starts before the other ends
        return (newStart < aptEnd && newEnd > aptStart);
    });
}

// Provider management functions
async function saveProvider(providerData) {
    try {
        showLoading();
        
        if (providerData.id) {
            // Update existing provider
            if (useApiBackend) {
                await apiPut(`/api/providers/${providerData.id}`, {
                    name: providerData.name,
                    email: providerData.email || '',
                    title: providerData.title || '',
                    color: providerData.color
                });
            } else {
            const providerRef = doc(db, 'providers', providerData.id);
            await updateDoc(providerRef, {
                name: providerData.name,
                email: providerData.email || '',
                title: providerData.title || '',
                color: providerData.color,
                updatedAt: Timestamp.now()
            });
            }
            showToast('Provider updated successfully');
        }

        if (!providerData.id) {
            // Add new provider
            if (useApiBackend) {
                await apiPost('/api/providers', {
                    name: providerData.name,
                    email: providerData.email || '',
                    title: providerData.title || '',
                    color: providerData.color
                });
            } else {
            await addDoc(collection(db, 'providers'), {
                name: providerData.name,
                email: providerData.email || '',
                title: providerData.title || '',
                color: providerData.color,
                    ownerUid: auth.currentUser ? auth.currentUser.uid : null,
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            });
            }
            showToast('Provider added successfully');
        }
        
        hideLoading();
    } catch (error) {
        console.error('Error saving provider:', error);
        showToast('Error saving provider. Please try again.', 'error');
        hideLoading();
    }
}

async function deleteProvider(providerId) {
    try {
        showLoading();
        
        // Update appointments to remove provider reference
        const appointmentsQuery = query(
            collection(db, 'appointments'),
            where('providerId', '==', providerId),
            where('ownerUid', '==', auth.currentUser ? auth.currentUser.uid : null)
        );
        const appointmentDocs = useApiBackend ? { docs: [] } : await getDocs(appointmentsQuery);
        
        const updatePromises = appointmentDocs.docs.map(doc => 
            updateDoc(doc.ref, { providerId: null })
        );
        await Promise.all(updatePromises);
        
        // Delete the provider
        if (useApiBackend) {
            await apiDelete(`/api/providers/${providerId}`);
        } else {
        await deleteDoc(doc(db, 'providers', providerId));
        }
        
        showToast('Provider deleted successfully');
        hideLoading();
    } catch (error) {
        console.error('Error deleting provider:', error);
        showToast('Error deleting provider. Please try again.', 'error');
        hideLoading();
    }
}

// Automation functions
async function scheduleReminder(appointment) {
    if (!currentSettings.autoReminders) return;
    
    const reminderTime = new Date(appointment.start.getTime() - (currentSettings.reminderTime * 60 * 60 * 1000));
    const now = new Date();
    
    if (reminderTime > now) {
        // In a real app, this would integrate with email/SMS service
        console.log(`Reminder scheduled for ${appointment.clientId} at ${reminderTime}`);
        
        // Store reminder in database for tracking
        try {
            await addDoc(collection(db, 'reminders'), {
                appointmentId: appointment.id,
                clientId: appointment.clientId,
                scheduledFor: Timestamp.fromDate(reminderTime),
                sent: false,
                createdAt: Timestamp.now()
            });
        } catch (error) {
            console.error('Error scheduling reminder:', error);
        }
    }
}

// Analytics functions
function calculateAnalytics(period = 'week') {
    const now = new Date();
    let startDate, endDate;
    
    switch (period) {
        case 'week':
            startDate = new Date(now);
            startDate.setDate(now.getDate() - now.getDay());
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(startDate);
            endDate.setDate(startDate.getDate() + 6);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'month':
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'quarter':
            const quarter = Math.floor(now.getMonth() / 3);
            startDate = new Date(now.getFullYear(), quarter * 3, 1);
            endDate = new Date(now.getFullYear(), quarter * 3 + 3, 0);
            endDate.setHours(23, 59, 59, 999);
            break;
        case 'year':
            startDate = new Date(now.getFullYear(), 0, 1);
            endDate = new Date(now.getFullYear(), 11, 31);
            endDate.setHours(23, 59, 59, 999);
            break;
        default:
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
            endDate = now;
    }
    
    const periodAppointments = appointments.filter(apt => 
        apt.start >= startDate && apt.start <= endDate
    );
    
    const totalAppointments = periodAppointments.length;
    const totalHours = Math.round((periodAppointments.reduce((sum, apt) => sum + apt.duration, 0) / 60) * 10) / 10;
    const noShows = periodAppointments.filter(apt => apt.status === 'no-show').length;
    const noShowRate = totalAppointments > 0 ? Math.round((noShows / totalAppointments) * 100) : 0;
    
    // Calculate utilization (appointments vs available slots)
    const workingHours = 13; // 9 AM to 10 PM
    const workingDays = period === 'week' ? 7 : (period === 'month' ? 30 : (period === 'quarter' ? 90 : 365));
    const availableHours = workingHours * workingDays;
    const utilizationRate = Math.round((totalHours / availableHours) * 100);
    
    return {
        totalAppointments,
        totalHours,
        noShowRate,
        utilizationRate,
        periodAppointments
    };
}

// Firebase operations
async function saveClient(clientData) {
    try {
        showLoading();
        console.log('Saving client data:', clientData);
        console.log('Database instance:', db);
        
        // Validate required fields
        if (!clientData.name || clientData.name.trim() === '') {
            throw new Error('Client name is required');
        }
        
        // Ensure we have proper data structure
        const clientDoc = {
            name: clientData.name.trim(),
            email: (clientData.email || '').trim(),
            phone: (clientData.phone || '').trim(),
            color: clientData.color || '#3b82f6',
            notes: (clientData.notes || '').trim(),
            ownerUid: auth.currentUser ? auth.currentUser.uid : null,
            updatedAt: Timestamp.now()
        };
        
        if (clientData.id) {
            // Update existing client
            console.log('Updating existing client:', clientData.id);
            if (useApiBackend) {
                await apiPut(`/api/clients/${clientData.id}`, clientDoc);
            } else {
            const clientRef = doc(db, 'clients', clientData.id);
            await updateDoc(clientRef, clientDoc);
            console.log('Client updated successfully');
            }
            
            // Force calendar refresh after client update
            setTimeout(() => {
                console.log('Refreshing calendar after client update');
                renderCalendarEvents();
                updateAppointmentClientOptions();
            }, 100);
            
            showToast('Client updated successfully');
        } else {
            // Add new client
            console.log('Adding new client');
            clientDoc.createdAt = Timestamp.now();
            
            if (useApiBackend) {
                await apiPost('/api/clients', clientDoc);
            } else {
            const docRef = await addDoc(collection(db, 'clients'), clientDoc);
            console.log('Client added with ID:', docRef.id);
            }
            
            // Don't update local state here - let Firebase listener handle it
            // This prevents duplicates since the listener will pick up the new document
            
            // Force calendar refresh after client creation
            setTimeout(() => {
                console.log('Refreshing calendar after client creation');
                renderCalendarEvents();
                updateAppointmentClientOptions();
            }, 100);
            
            showToast('Client added successfully');
        }
        
        if (useApiBackend) {
            await loadDataFromApi();
        }
        hideLoading();
    } catch (error) {
        console.error('Error saving client:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        
        let errorMessage = 'Error saving client. ';
        if (error.code === 'permission-denied') {
            errorMessage += 'Database permission denied. Please check Firestore rules.';
        } else if (error.code === 'unavailable') {
            errorMessage += 'Database temporarily unavailable. Please try again.';
        } else if (error.code === 'invalid-argument') {
            errorMessage += 'Invalid data format. Please check all fields.';
        } else {
            errorMessage += error.message || 'Please try again.';
        }
        
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

async function deleteClient(clientId) {
    try {
        showLoading();
        console.log('Deleting client:', clientId);
        
        // First, delete all appointments for this client
        if (!useApiBackend) {
        const appointmentsQuery = query(
            collection(db, 'appointments'),
                where('clientId', '==', clientId),
                where('ownerUid', '==', auth.currentUser ? auth.currentUser.uid : null)
        );
        const appointmentDocs = await getDocs(appointmentsQuery);
        console.log('Found', appointmentDocs.docs.length, 'appointments to delete');
        const deletePromises = appointmentDocs.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        }
        
        // Then delete the client
        if (useApiBackend) {
            await apiDelete(`/api/clients/${clientId}`);
        } else {
        await deleteDoc(doc(db, 'clients', clientId));
        }
        console.log('Client deleted successfully:', clientId);
        
        if (useApiBackend) {
            await loadDataFromApi();
        }
        
        showToast('Client and all associated appointments deleted');
        hideLoading();
    } catch (error) {
        console.error('Error deleting client:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        
        let errorMessage = 'Error deleting client. ';
        if (error.code === 'permission-denied') {
            errorMessage += 'Database permission denied. Please check Firestore rules.';
        } else if (error.code === 'unavailable') {
            errorMessage += 'Database temporarily unavailable. Please try again.';
        } else if (error.code === 'not-found') {
            errorMessage += 'Client not found. It may have already been deleted.';
        } else {
            errorMessage += error.message || 'Please try again.';
        }
        
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

async function saveAppointment(appointmentData) {
    try {
        showLoading();
        console.log('Saving appointment data:', appointmentData);
        console.log('Database instance:', db);
        
        // Validate required fields
        if (!appointmentData.clientId) {
            throw new Error('Client selection is required');
        }
        if (!appointmentData.start || !appointmentData.end) {
            throw new Error('Start and end times are required');
        }
        
        // Debug logging for voice appointments
        console.log('saveAppointment received data:', {
            clientId: appointmentData.clientId,
            start: appointmentData.start,
            startType: typeof appointmentData.start,
            end: appointmentData.end,
            endType: typeof appointmentData.end,
            isDateStart: appointmentData.start instanceof Date,
            isDateEnd: appointmentData.end instanceof Date
        });
        
        // Ensure we have proper data structure
        // Handle both Date objects and Timestamp objects
        let startTimestamp, endTimestamp;
        
        if (appointmentData.start instanceof Date) {
            startTimestamp = Timestamp.fromDate(appointmentData.start);
        } else if (appointmentData.start && typeof appointmentData.start.toDate === 'function') {
            startTimestamp = appointmentData.start; // Already a Timestamp
        } else {
            throw new Error('Invalid start date format');
        }
        
        if (appointmentData.end instanceof Date) {
            endTimestamp = Timestamp.fromDate(appointmentData.end);
        } else if (appointmentData.end && typeof appointmentData.end.toDate === 'function') {
            endTimestamp = appointmentData.end; // Already a Timestamp
        } else {
            throw new Error('Invalid end date format');
        }
        
        const appointmentDoc = {
            clientId: appointmentData.clientId,
            providerId: appointmentData.providerId || '',
            start: startTimestamp,
            end: endTimestamp,
            duration: appointmentData.duration || 50,
            priority: appointmentData.priority || 'normal',
            status: appointmentData.status || 'scheduled',
            notes: (appointmentData.notes || '').trim(),
            repeats: appointmentData.repeats || 'none',
            ownerUid: auth.currentUser ? auth.currentUser.uid : null,
            updatedAt: Timestamp.now()
        };
        
        if (appointmentData.id) {
            // Update existing appointment
            console.log('Updating existing appointment:', appointmentData.id);
            if (useApiBackend) {
                await apiPut(`/api/appointments/${appointmentData.id}`, {
                    clientId: appointmentData.clientId,
                    providerId: appointmentData.providerId || null,
                    start: startTimestamp.toDate(),
                    end: endTimestamp.toDate(),
                    duration: appointmentData.duration || 50,
                    priority: appointmentData.priority || 'normal',
                    status: appointmentData.status || 'scheduled',
                    notes: (appointmentData.notes || '').trim(),
                    repeats: appointmentData.repeats || 'none'
                });
                showToast('Appointment updated successfully');
                await loadDataFromApi();
            } else {
                const appointmentRef = doc(db, 'appointments', appointmentData.id);
                
                // Check if we're changing from non-recurring to recurring
                const originalAppointment = appointments.find(apt => apt.id === appointmentData.id);
                const wasRecurring = originalAppointment && originalAppointment.repeats && originalAppointment.repeats !== 'none';
                const isNowRecurring = appointmentDoc.repeats && appointmentDoc.repeats !== 'none';
                
                if (!wasRecurring && isNowRecurring) {
                    // Converting to recurring: delete the original and create recurring series
                    console.log('Converting appointment to recurring series');
                    await deleteDoc(appointmentRef);
                    await createRecurringAppointments(appointmentDoc);
                    showToast('Recurring appointments created successfully');
                } else if (wasRecurring && !isNowRecurring) {
                    // Converting from recurring to single: just update this one
                    await updateDoc(appointmentRef, appointmentDoc);
                    showToast('Appointment updated to non-recurring');
                } else {
                    // Standard update
                    await updateDoc(appointmentRef, appointmentDoc);
                    showToast('Appointment updated successfully');
                }
            }
        } else {
            // Add new appointment
            console.log('Adding new appointment to Firestore');
            appointmentDoc.createdAt = Timestamp.now();
            
            if (useApiBackend) {
                // API backend - create single appointment (recurrence not implemented in API yet)
                await apiPost('/api/appointments', {
                    clientId: appointmentData.clientId,
                    providerId: appointmentData.providerId || null,
                    start: startTimestamp.toDate(),
                    end: endTimestamp.toDate(),
                    duration: appointmentData.duration || 50,
                    priority: appointmentData.priority || 'normal',
                    status: appointmentData.status || 'scheduled',
                    notes: (appointmentData.notes || '').trim(),
                    repeats: appointmentData.repeats || 'none'
                });
                showToast('Appointment created successfully');
            } else {
            if (appointmentDoc.repeats && appointmentDoc.repeats !== 'none') {
                // Create recurring appointments
                await createRecurringAppointments(appointmentDoc);
                showToast('Recurring appointments created successfully');
            } else {
                // Single appointment
                const docRef = await addDoc(collection(db, 'appointments'), appointmentDoc);
                console.log('Appointment added with ID:', docRef.id);
                showToast('Appointment created successfully');
                }
            }
        }
        
        hideLoading();
    } catch (error) {
        console.error('Error saving appointment:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack
        });
        
        let errorMessage = 'Error saving appointment. ';
        if (error.code === 'permission-denied') {
            errorMessage += 'Database permission denied. Please check Firestore rules.';
        } else if (error.code === 'unavailable') {
            errorMessage += 'Database temporarily unavailable. Please try again.';
        } else if (error.code === 'invalid-argument') {
            errorMessage += 'Invalid data format. Please check all fields.';
        } else if (error.code === 'not-found') {
            errorMessage += 'Referenced client not found. Please refresh and try again.';
        } else {
            errorMessage += error.message || 'Please try again.';
        }
        
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

// Improved fuzzy name matching for voice commands
function findClientByFuzzyName(spokenName) {
    if (!spokenName || typeof spokenName !== 'string') return null;
    
    const spoken = spokenName.toLowerCase().trim();
    console.log('🔍 Finding client for spoken name:', spoken);
    console.log('🔍 Available clients:', clients.map(c => c.name));
    
    // First try exact matches
    let client = clients.find(c => c.name.toLowerCase() === spoken);
    if (client) {
        console.log('✅ Found exact match:', client.name);
        return client;
    }
    
    // Try partial matches (contains)
    client = clients.find(c => c.name.toLowerCase().includes(spoken) || spoken.includes(c.name.toLowerCase()));
    if (client) {
        console.log('✅ Found partial match:', client.name);
        return client;
    }
    
    // Enhanced fuzzy matching with multiple algorithms
    let bestMatch = null;
    let bestScore = 0;
    
    for (const c of clients) {
        const clientName = c.name.toLowerCase();
        let score = 0;
        
        // Algorithm 1: Phonetic similarity
        if (soundsSimilar(spoken, clientName)) {
            score += 0.6;
        }
        
        // Algorithm 2: Levenshtein distance similarity
        const distance = levenshteinDistance(spoken, clientName);
        const maxLength = Math.max(spoken.length, clientName.length);
        const similarity = 1 - (distance / maxLength);
        if (similarity >= 0.4) { // 40% similarity threshold
            score += similarity * 0.5;
        }
        
        // Algorithm 3: Common letter sequences
        const commonSequences = getCommonSequences(spoken, clientName);
        if (commonSequences > 2) {
            score += 0.3;
        }
        
        // Algorithm 4: First letter match (important for voice recognition)
        if (spoken[0] === clientName[0]) {
            score += 0.2;
        }
        
        console.log(`🔍 Matching "${spoken}" vs "${clientName}": score ${score.toFixed(2)}`);
        
        if (score > bestScore && score >= 0.5) { // Minimum 50% confidence
            bestScore = score;
            bestMatch = c;
        }
    }
    
    if (bestMatch) {
        console.log('✅ Found fuzzy match:', bestMatch.name, 'for spoken:', spoken, 'score:', bestScore.toFixed(2));
        return bestMatch;
    }
    
    console.log('❌ No client match found for:', spoken);
    return null;
}

// Helper function to count common letter sequences
function getCommonSequences(str1, str2) {
    let count = 0;
    const minLength = Math.min(str1.length, str2.length);
    
    for (let i = 0; i < minLength - 1; i++) {
        const seq1 = str1.substring(i, i + 2);
        const seq2 = str2.substring(i, i + 2);
        if (seq1 === seq2) {
            count++;
        }
    }
    
    return count;
}

// Basic phonetic similarity checker for names
function soundsSimilar(name1, name2) {
    // Remove common variations and normalize
    const normalize = (name) => {
        return name.toLowerCase()
            .replace(/[^a-z]/g, '') // Remove non-letters
            .replace(/ph/g, 'f')    // Replace ph with f
            .replace(/ck/g, 'k')    // Replace ck with k
            .replace(/qu/g, 'kw')   // Replace qu with kw
            .replace(/sh/g, 's')    // Replace sh with s (helps with Shanequa/Chinequa)
            .replace(/ch/g, 's')    // Replace ch with s 
            .replace(/[aeiou]/g, '') // Remove vowels for consonant matching
    };
    
    const norm1 = normalize(name1);
    const norm2 = normalize(name2);
    
    // Check if consonant structures are similar
    if (norm1 === norm2) return true;
    
    // Check if one is a substring of the other (after normalization)
    if (norm1.includes(norm2) || norm2.includes(norm1)) return true;
    
    // Calculate simple edit distance for all names with more lenient threshold
    const distance = levenshteinDistance(name1.toLowerCase(), name2.toLowerCase());
    const maxLength = Math.max(name1.length, name2.length);
    const similarity = 1 - (distance / maxLength);
    
    // More lenient similarity threshold for better matching
    return similarity >= 0.5; // 50% similarity threshold
}

// Simple Levenshtein distance calculation
function levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    
    return matrix[str2.length][str1.length];
}

async function createRecurringAppointments(appointmentData) {
    const appointments = [];
    const startDate = appointmentData.start.toDate();
    const endDate = appointmentData.end.toDate();
    const duration = appointmentData.duration;
    
    // Create appointments for the next 6 months
    const endRecurrence = new Date();
    endRecurrence.setMonth(endRecurrence.getMonth() + 6);
    
    let currentDate = new Date(startDate);
    
    while (currentDate <= endRecurrence) {
        const appointmentEnd = new Date(currentDate);
        appointmentEnd.setMinutes(appointmentEnd.getMinutes() + duration);
        
        appointments.push({
            ...appointmentData,
            start: Timestamp.fromDate(new Date(currentDate)),
            end: Timestamp.fromDate(appointmentEnd)
        });
        
        // Calculate next occurrence
        switch (appointmentData.repeats) {
            case 'weekly':
                currentDate.setDate(currentDate.getDate() + 7);
                break;
            case 'biweekly':
                currentDate.setDate(currentDate.getDate() + 14);
                break;
            case 'monthly':
                currentDate.setMonth(currentDate.getMonth() + 1);
                break;
        }
    }
    
    // Save all recurring appointments
    const promises = appointments.map(apt => addDoc(collection(db, 'appointments'), apt));
    await Promise.all(promises);
}

async function deleteAppointment(appointmentId) {
    try {
        console.log('Starting deleteAppointment for ID:', appointmentId);
        showLoading();
        
        if (!appointmentId) {
            throw new Error('Appointment ID is required');
        }
        
        if (useApiBackend) {
            await apiDelete(`/api/appointments/${appointmentId}`);
        } else {
        console.log('Deleting appointment from Firebase...');
        await deleteDoc(doc(db, 'appointments', appointmentId));
        console.log('Appointment deleted from Firebase successfully');
        }
        
        showToast('Appointment deleted successfully');
        if (useApiBackend) {
            await loadDataFromApi();
        }
        hideLoading();
        console.log('Delete process completed successfully');
    } catch (error) {
        console.error('Error deleting appointment:', error);
        console.error('Error details:', {
            code: error.code,
            message: error.message,
            appointmentId: appointmentId
        });
        
        let errorMessage = 'Error deleting appointment. ';
        if (error.code === 'permission-denied') {
            errorMessage += 'Database permission denied.';
        } else if (error.code === 'unavailable') {
            errorMessage += 'Database temporarily unavailable.';
        } else {
            errorMessage += error.message || 'Please try again.';
        }
        
        showToast(errorMessage, 'error');
        hideLoading();
    }
}

// Data listeners
function setupDataListeners() {
    console.log('Setting up Firebase data listeners...');
    console.log('Database instance check:', db);
    
    try {
        if (!useApiBackend) {
            // Listen for client changes (scoped to current user)
            const clientsQuery = query(
                collection(db, 'clients'),
                where('ownerUid', '==', auth.currentUser ? auth.currentUser.uid : null),
                orderBy('name')
            );
        onSnapshot(clientsQuery, 
            (snapshot) => {
                console.log('Clients snapshot received:', snapshot.size, 'documents');
                clients = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    createdAt: doc.data().createdAt?.toDate(),
                    updatedAt: doc.data().updatedAt?.toDate()
                }));
                console.log('Clients loaded:', clients.length);
                renderClientList();
                updateClientFilter();
                updateAppointmentClientOptions();
            },
            (error) => {
                console.error('Error listening to clients:', error);
                showToast('Error loading clients: ' + error.message, 'error');
            }
        );
        }
        
        if (!useApiBackend) {
            // Listen for provider changes (scoped to current user)
            const providersQuery = query(
                collection(db, 'providers'),
                where('ownerUid', '==', auth.currentUser ? auth.currentUser.uid : null),
                orderBy('name')
            );
        onSnapshot(providersQuery, 
            (snapshot) => {
                console.log('Providers snapshot received:', snapshot.size, 'documents');
                providers = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    createdAt: doc.data().createdAt?.toDate(),
                    updatedAt: doc.data().updatedAt?.toDate()
                }));
                console.log('Providers loaded:', providers.length);
                renderProvidersList();
                updateAppointmentProviderOptions();
            },
            (error) => {
                console.error('Error listening to providers:', error);
                showToast('Error loading providers: ' + error.message, 'error');
            }
        );
        }
        
        if (!useApiBackend) {
            // Listen for appointment changes (scoped to current user)
            const appointmentsQuery = query(
                collection(db, 'appointments'),
                where('ownerUid', '==', auth.currentUser ? auth.currentUser.uid : null),
                orderBy('start')
            );
        onSnapshot(appointmentsQuery, 
            (snapshot) => {
                console.log('Appointments snapshot received:', snapshot.size, 'documents');
                appointments = snapshot.docs.map(doc => {
                    const data = doc.data();
                    const appointment = {
                        id: doc.id,
                        ...data,
                        start: data.start?.toDate(),
                        end: data.end?.toDate(),
                        createdAt: data.createdAt?.toDate(),
                        updatedAt: data.updatedAt?.toDate()
                    };
                    
                    // Log any suspicious appointments for debugging
                    if (!appointment.start || !appointment.end || !appointment.clientId) {
                        console.warn('Found malformed appointment:', appointment);
                    } else if (appointment.end <= appointment.start) {
                        console.warn('Found appointment with invalid duration:', appointment);
                    }
                    
                    return appointment;
                });
                console.log('Appointments loaded:', appointments.length);
                
                // Log all appointments and check for overlaps
                appointments.forEach((apt, index) => {
                    if (apt.start && apt.end) {
                        const duration = (apt.end - apt.start) / 60000;
                        console.log(`Appointment ${index + 1}: ${apt.start.toLocaleString()} - ${apt.end.toLocaleString()} (${duration} minutes)`);
                    }
                });
                
                // Check for overlapping appointments and warn
                const overlaps = findOverlappingAppointments();
                if (overlaps.length > 0) {
                    console.warn('Found overlapping appointments:', overlaps);
                    overlaps.forEach(overlap => {
                        const client1 = clients.find(c => c.id === overlap.apt1.clientId)?.name || 'Unknown';
                        const client2 = clients.find(c => c.id === overlap.apt2.clientId)?.name || 'Unknown';
                        console.warn(`Overlap: ${client1} (${overlap.apt1.start.toLocaleTimeString()}) conflicts with ${client2} (${overlap.apt2.start.toLocaleTimeString()})`);
                    });
                }
                
                renderCalendarEvents();
                updateWeeklySummary();
            },
            (error) => {
                console.error('Error listening to appointments:', error);
                showToast('Error loading appointments: ' + error.message, 'error');
            }
        );
        }
        
        console.log('Firebase listeners setup complete');
    } catch (error) {
        console.error('Error setting up Firebase listeners:', error);
        showToast('Error connecting to database: ' + error.message, 'error');
    }
}

// UI rendering functions
function renderClientList() {
    const clientList = elements.clientList;
    const noClientsMsg = document.getElementById('no-clients-msg');
    
    // Check if elements exist before proceeding
    if (!clientList) {
        console.error('Client list element not found');
        return;
    }
    
    if (clients.length === 0) {
        if (noClientsMsg) {
            noClientsMsg.classList.remove('hidden');
        }
        clientList.innerHTML = '';
        return;
    }
    
    if (noClientsMsg) {
        noClientsMsg.classList.add('hidden');
    }
    
    const filteredClients = getFilteredClients();
    
    clientList.innerHTML = filteredClients.map(client => `
        <div class="client-item p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer border-l-4" 
             style="border-left-color: ${client.color}" 
             data-client-id="${client.id}">
            <div class="flex justify-between items-start">
                <div class="flex-1">
                    <h3 class="font-medium text-gray-800">${client.name}</h3>
                    ${client.email ? `<p class="text-sm text-gray-600">${client.email}</p>` : ''}
                    ${client.phone ? `<p class="text-sm text-gray-600">${client.phone}</p>` : ''}
                </div>
                <div class="flex space-x-2">
                    <button class="edit-client-btn text-gray-500 hover:text-indigo-600" data-client-id="${client.id}">
                        <span class="material-icons text-sm">edit</span>
                    </button>
                    <button class="delete-client-btn text-gray-500 hover:text-red-600" data-client-id="${client.id}">
                        <span class="material-icons text-sm">delete</span>
                    </button>
                </div>
            </div>
            ${client.notes ? `<p class="text-xs text-gray-500 mt-2">${client.notes.substring(0, 100)}${client.notes.length > 100 ? '...' : ''}</p>` : ''}
        </div>
    `).join('');
    
    // Add event listeners
    clientList.querySelectorAll('.edit-client-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const clientId = btn.dataset.clientId;
            openClientModal(clientId);
        });
    });
    
    clientList.querySelectorAll('.delete-client-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const clientId = btn.dataset.clientId;
            if (confirm('Are you sure you want to delete this client and all their appointments?')) {
                deleteClient(clientId);
            }
        });
    });
}

function getFilteredClients() {
    const filterValue = elements.clientFilter.value;
    if (filterValue === 'all') {
        return clients;
    }
    return clients.filter(client => client.id === filterValue);
}

function updateClientFilter() {
    const filter = elements.clientFilter;
    
    // Check if element exists before proceeding
    if (!filter) {
        console.error('Client filter element not found');
        return;
    }
    
    const currentValue = filter.value;
    
    filter.innerHTML = '<option value="all">All Clients</option>';
    
    clients.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = client.name;
        filter.appendChild(option);
    });
    
    // Restore previous selection if it still exists
    if (currentValue && [...filter.options].some(opt => opt.value === currentValue)) {
        filter.value = currentValue;
    }
}

function updateAppointmentClientOptions() {
    const clientSelect = document.getElementById('appointment-client');
    const currentValue = clientSelect.value;
    
    clientSelect.innerHTML = '';
    
    clients.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = client.name;
        clientSelect.appendChild(option);
    });
    
    // Restore previous selection if it still exists
    if (currentValue && [...clientSelect.options].some(opt => opt.value === currentValue)) {
        clientSelect.value = currentValue;
    }
}

function renderCalendarEvents() {
    if (!calendar) return;
    
    const filteredAppointments = getFilteredAppointments();
    const events = filteredAppointments
        .filter(appointment => {
            // Filter out any malformed appointments
            if (!appointment.start || !appointment.end || !appointment.clientId) {
                console.warn('Filtering out malformed appointment:', appointment);
                return false;
            }
            
            // Ensure start and end are valid dates
            const startDate = new Date(appointment.start);
            const endDate = new Date(appointment.end);
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                console.warn('Filtering out appointment with invalid dates:', appointment);
                return false;
            }
            
            // Ensure appointment has a reasonable duration (at least 1 minute)
            if (endDate <= startDate) {
                console.warn('Filtering out appointment with invalid duration:', appointment);
                return false;
            }
            
            return true;
        })
        .map(appointment => {
            const client = clients.find(c => c.id === appointment.clientId);
            const provider = providers.find(p => p.id === appointment.providerId);
            const clientName = client ? client.name : 'Unknown Client';
            
            // Use client color only
            const eventColor = client ? client.color : '#4f46e5';
            
            // Show only first name for cleaner display
            const firstName = clientName.split(' ')[0];
            
            const eventObject = {
                id: appointment.id,
                title: getDisplayName(firstName), // Apply privacy mode to client's first name
                start: appointment.start,
                end: appointment.end,
                backgroundColor: eventColor,
                borderColor: eventColor,
                textColor: 'white',
                classNames: ['appointment-event'],
                display: 'block',
                editable: true,      // Enable dragging only
                startEditable: true, // Allow dragging to change start time
                durationEditable: false, // Disable resizing to change duration
                resourceEditable: true, // Allow resource changes
                extendedProps: {
                    appointment: appointment,
                    client: client,
                    provider: provider,
                    originalClientName: clientName,
                    firstName: firstName,
                    clientId: appointment.clientId
                }
            };
            
            console.log('🔧 Creating event object:', firstName, 'editable:', eventObject.editable);
            return eventObject;
        });
    
    console.log('Rendering calendar events:', events.length, 'valid appointments');
    calendar.removeAllEvents();
    calendar.addEventSource(events);
}

function getFilteredAppointments() {
    const filterValue = elements.clientFilter.value;
    if (filterValue === 'all') {
        return appointments;
    }
    return appointments.filter(appointment => appointment.clientId === filterValue);
}

function updateWeeklySummary() {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    
    console.log('Weekly summary range:', startOfWeek, 'to', endOfWeek);
    console.log('Total appointments:', appointments.length);
    
    const weeklyAppointments = appointments.filter(apt => {
        const aptStart = apt.start;
        const isInRange = aptStart >= startOfWeek && aptStart <= endOfWeek;
        
        if (!isInRange && aptStart) {
            console.log('Appointment outside range:', aptStart, 'repeats:', apt.repeats);
        }
        
        return isInRange && aptStart && apt.duration;
    });
    
    console.log('Weekly appointments found:', weeklyAppointments.length);
    weeklyAppointments.forEach(apt => {
        console.log('- Appointment:', apt.start, 'duration:', apt.duration, 'repeats:', apt.repeats);
    });
    
    const totalMinutes = weeklyAppointments.reduce((sum, apt) => sum + apt.duration, 0);
    const totalHours = Math.round((totalMinutes / 60) * 10) / 10;
    
    elements.weeklySummary.innerHTML = `Total Hours: <span class="font-bold">${totalHours}h</span>`;
    document.getElementById('weekly-appointments').textContent = weeklyAppointments.length;
}

// Provider UI functions
function renderProvidersList() {
    const providersList = document.getElementById('providers-list');
    
    if (providers.length === 0) {
        providersList.innerHTML = `
            <div class="text-center text-gray-500 py-8">
                <span class="material-icons text-4xl mb-2 block">person_add</span>
                <p>No providers yet</p>
                <p class="text-sm">Add your first provider to get started</p>
            </div>
        `;
        return;
    }
    
    providersList.innerHTML = providers.map(provider => `
        <div class="provider-item p-4 bg-gray-50 rounded-lg border-l-4" style="border-left-color: ${provider.color}">
            <div class="flex justify-between items-start">
                <div class="flex-1">
                    <h3 class="font-medium text-gray-800">${provider.name}</h3>
                    ${provider.title ? `<p class="text-sm text-gray-600">${provider.title}</p>` : ''}
                    ${provider.email ? `<p class="text-sm text-gray-500">${provider.email}</p>` : ''}
                </div>
                <div class="flex space-x-2">
                    <button class="edit-provider-btn text-gray-500 hover:text-indigo-600" data-provider-id="${provider.id}">
                        <span class="material-icons text-sm">edit</span>
                    </button>
                    <button class="delete-provider-btn text-gray-500 hover:text-red-600" data-provider-id="${provider.id}">
                        <span class="material-icons text-sm">delete</span>
                    </button>
                </div>
            </div>
        </div>
    `).join('');
    
    // Add event listeners
    providersList.querySelectorAll('.edit-provider-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const providerId = btn.dataset.providerId;
            openProviderModal(providerId);
        });
    });
    
    providersList.querySelectorAll('.delete-provider-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const providerId = btn.dataset.providerId;
            if (confirm('Are you sure you want to delete this provider?')) {
                deleteProvider(providerId);
            }
        });
    });
}

function updateAppointmentProviderOptions() {
    const providerSelect = document.getElementById('appointment-provider');
    const currentValue = providerSelect.value;
    
    providerSelect.innerHTML = '<option value="">No specific provider</option>';
    
    providers.forEach(provider => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        providerSelect.appendChild(option);
    });
    
    // Restore previous selection if it still exists
    if (currentValue && [...providerSelect.options].some(opt => opt.value === currentValue)) {
        providerSelect.value = currentValue;
    }
}

// Analytics UI functions
function openAnalyticsModal() {
    const modal = document.getElementById('analytics-modal');
    const period = document.getElementById('analytics-period').value;
    
    updateAnalyticsDisplay(period);
    modal.classList.remove('hidden');
}

function updateAnalyticsDisplay(period) {
    const analytics = calculateAnalytics(period);
    
    // Update summary cards
    document.getElementById('total-appointments').textContent = analytics.totalAppointments;
    document.getElementById('total-hours').textContent = `${analytics.totalHours}h`;
    document.getElementById('no-show-rate').textContent = `${analytics.noShowRate}%`;
    document.getElementById('utilization-rate').textContent = `${analytics.utilizationRate}%`;
    
    // Update provider stats
    updateProviderStats(analytics.periodAppointments);
    
    // Update recent appointments table
    updateRecentAppointments(analytics.periodAppointments);
}

function updateProviderStats(periodAppointments) {
    const providerStats = document.getElementById('provider-stats');
    
    if (providers.length === 0) {
        providerStats.innerHTML = '<p class="text-gray-500">No providers available</p>';
        return;
    }
    
    const stats = providers.map(provider => {
        const providerAppointments = periodAppointments.filter(apt => apt.providerId === provider.id);
        const hours = Math.round((providerAppointments.reduce((sum, apt) => sum + apt.duration, 0) / 60) * 10) / 10;
        
        return {
            name: provider.name,
            appointments: providerAppointments.length,
            hours: hours,
            color: provider.color
        };
    });
    
    providerStats.innerHTML = stats.map(stat => `
        <div class="flex justify-between items-center p-2 border-l-4" style="border-left-color: ${stat.color}">
            <span class="font-medium">${stat.name}</span>
            <div class="text-sm text-gray-600">
                <span>${stat.appointments} apt</span> • <span>${stat.hours}h</span>
            </div>
        </div>
    `).join('');
}

function updateRecentAppointments(periodAppointments) {
    const tbody = document.getElementById('recent-appointments');
    
    const recent = periodAppointments
        .sort((a, b) => b.start - a.start)
        .slice(0, 10);
    
    tbody.innerHTML = recent.map(apt => {
        const client = clients.find(c => c.id === apt.clientId);
        const provider = providers.find(p => p.id === apt.providerId);
        
        return `
            <tr>
                <td class="px-4 py-2 text-sm">${apt.start.toLocaleDateString()}</td>
                <td class="px-4 py-2 text-sm">${client ? client.name : 'Unknown'}</td>
                <td class="px-4 py-2 text-sm">${provider ? provider.name : 'Unassigned'}</td>
                <td class="px-4 py-2 text-sm">${apt.duration}min</td>
                <td class="px-4 py-2 text-sm">
                    <span class="px-2 py-1 text-xs rounded-full ${getStatusColor(apt.status)}">
                        ${apt.status || 'scheduled'}
                    </span>
                </td>
            </tr>
        `;
    }).join('');
}

function getStatusColor(status) {
    switch (status) {
        case 'completed': return 'bg-green-100 text-green-800';
        case 'cancelled': return 'bg-red-100 text-red-800';
        case 'no-show': return 'bg-yellow-100 text-yellow-800';
        case 'confirmed': return 'bg-blue-100 text-blue-800';
        default: return 'bg-gray-100 text-gray-800';
    }
}

// Modal functions
function openClientModal(clientId = null) {
    const modal = elements.clientModal;
    const title = document.getElementById('client-modal-title');
    const form = elements.clientForm;
    const deleteBtn = document.getElementById('delete-client-btn');
    
    // Reset form
    form.reset();
    
    if (clientId) {
        const client = clients.find(c => c.id === clientId);
        if (client) {
            title.textContent = 'Edit Client';
            document.getElementById('client-id').value = client.id;
            document.getElementById('client-name').value = client.name;
            document.getElementById('client-email').value = client.email || '';
            document.getElementById('client-phone').value = client.phone || '';
            document.getElementById('client-color').value = client.color;
            document.getElementById('client-notes').value = client.notes || '';
            deleteBtn.classList.remove('hidden');
        }
    } else {
        title.textContent = 'Add Client';
        document.getElementById('client-color').value = '#4f46e5';
        deleteBtn.classList.add('hidden');
    }
    
    modal.classList.remove('hidden');
}

function closeClientModal() {
    elements.clientModal.classList.add('hidden');
}

function openAppointmentModal(appointmentId = null, defaultStart = null) {
    console.log('openAppointmentModal called with appointmentId:', appointmentId);
    const modal = document.getElementById('appointment-modal');
    const title = document.getElementById('appointment-modal-title');
    const form = document.getElementById('appointment-form');
    const deleteBtn = document.getElementById('delete-appointment-btn');
    const noClientsMsg = document.getElementById('appointment-no-clients-msg');
    
    if (!modal) {
        console.error('Appointment modal not found!');
        return;
    }
    
    // Check if there are clients
    if (clients.length === 0) {
        noClientsMsg.classList.remove('hidden');
        // Still show the form, but disable client selection
        form.style.display = 'block';
        document.getElementById('appointment-client').innerHTML = '<option value="">Please add a client first</option>';
        document.getElementById('appointment-client').disabled = true;
    } else {
        noClientsMsg.classList.add('hidden');
        form.style.display = 'block';
        document.getElementById('appointment-client').disabled = false;
    }
    
    // Reset form
    form.reset();
    document.getElementById('conflict-warning').classList.add('hidden');
    
    if (appointmentId) {
        const appointment = appointments.find(a => a.id === appointmentId);
        if (appointment) {
            title.textContent = 'Edit Appointment';
            document.getElementById('appointment-id').value = appointment.id;
            document.getElementById('appointment-client').value = appointment.clientId;
            document.getElementById('appointment-provider').value = appointment.providerId || '';
            document.getElementById('appointment-start').value = formatDateTime(appointment.start);
            document.getElementById('appointment-duration').value = appointment.duration;
            document.getElementById('appointment-priority').value = appointment.priority || 'normal';
            document.getElementById('appointment-status').value = appointment.status || 'scheduled';
            document.getElementById('appointment-notes').value = appointment.notes || '';
            document.getElementById('appointment-repeats').value = appointment.repeats || 'none';
            deleteBtn.classList.remove('hidden');
        }
    } else {
        title.textContent = 'New Appointment';
        document.getElementById('appointment-duration').value = currentSettings.defaultDuration;
        if (defaultStart) {
            document.getElementById('appointment-start').value = formatDateTime(defaultStart);
            
            // Pre-calculate end time based on default duration
            const endTime = new Date(defaultStart.getTime() + currentSettings.defaultDuration * 60000);
            
            // If this came from a drag selection, we might have a better duration
            const urlParams = new URLSearchParams(window.location.hash);
            const selectedDuration = urlParams.get('duration');
            if (selectedDuration) {
                document.getElementById('appointment-duration').value = selectedDuration;
            }
        }
        deleteBtn.classList.add('hidden');
    }
    
    // Check for conflicts when start time or duration changes
    const startInput = document.getElementById('appointment-start');
    const durationInput = document.getElementById('appointment-duration');
    
    const checkConflicts = () => {
        const start = parseDateTime(startInput.value);
        const duration = parseInt(durationInput.value);
        const end = new Date(start.getTime() + duration * 60000);
        const currentAppointmentId = document.getElementById('appointment-id').value;
        
        const hasConflict = appointments.some(apt => {
            if (apt.id === currentAppointmentId) return false;
            return (start < apt.end && end > apt.start);
        });
        
        const conflictWarning = document.getElementById('conflict-warning');
        if (hasConflict) {
            conflictWarning.classList.remove('hidden');
        } else {
            conflictWarning.classList.add('hidden');
        }
    };
    
    startInput.addEventListener('change', checkConflicts);
    durationInput.addEventListener('change', checkConflicts);
    
    modal.classList.remove('hidden');
}

function closeAppointmentModal() {
    const modal = document.getElementById('appointment-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function openSettingsModal() {
    const modal = elements.settingsModal;
    
    // Load current settings
    document.getElementById('work-start-time').value = currentSettings.workStartTime;
    document.getElementById('work-end-time').value = currentSettings.workEndTime;
    document.getElementById('default-duration').value = currentSettings.defaultDuration;
    document.getElementById('auto-reminders').checked = currentSettings.autoReminders;
    document.getElementById('reminder-time').value = currentSettings.reminderTime;
    
    // Set working days
    for (let i = 0; i < 7; i++) {
        document.getElementById(`work-day-${i}`).checked = currentSettings.workingDays.includes(i);
    }
    
    modal.classList.remove('hidden');
}

function closeSettingsModal() {
    elements.settingsModal.classList.add('hidden');
}

// Provider modal functions
function openProviderModal(providerId = null) {
    const modal = document.getElementById('provider-modal');
    const title = document.getElementById('provider-modal-title');
    const form = document.getElementById('provider-form');
    const deleteBtn = document.getElementById('delete-provider-btn');
    
    // Reset form
    form.reset();
    
    if (providerId) {
        const provider = providers.find(p => p.id === providerId);
        if (provider) {
            title.textContent = 'Edit Provider';
            document.getElementById('provider-id').value = provider.id;
            document.getElementById('provider-name').value = provider.name;
            document.getElementById('provider-email').value = provider.email || '';
            document.getElementById('provider-title').value = provider.title || '';
            document.getElementById('provider-color').value = provider.color;
            deleteBtn.classList.remove('hidden');
        }
    } else {
        title.textContent = 'Add Provider';
        document.getElementById('provider-color').value = '#4f46e5';
        deleteBtn.classList.add('hidden');
    }
    
    modal.classList.remove('hidden');
}

function closeProviderModal() {
    document.getElementById('provider-modal').classList.add('hidden');
}

function openProvidersModal() {
    document.getElementById('providers-modal').classList.remove('hidden');
}

function closeProvidersModal() {
    document.getElementById('providers-modal').classList.add('hidden');
}

function closeAnalyticsModal() {
    document.getElementById('analytics-modal').classList.add('hidden');
}

// Calendar initialization

function initializeCalendar() {
    const calendarEl = document.getElementById('calendar');
    
    // Set mobile-friendly initial view
    const isMobile = window.innerWidth < 768;
    const initialView = isMobile ? 'timeGridWeek' : 'dayGridMonth';


    
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: initialView,
        initialDate: new Date(), // Start on today's date
        timeZone: 'local', // Use local timezone
        headerToolbar: false,
        stickyHeaderDates: false, // Disable sticky positioning in list view
        // Standard calendar settings
        fixedWeekCount: true,
        showNonCurrentDates: true,
        // Force day headers to show day names instead of numbers
        dayHeaderFormat: {
            weekday: 'short'  // Mon, Tue, Wed, etc.
        },
        height: 'parent',
        expandRows: true,
        editable: true,
        selectable: true,
        selectMirror: true,
        selectOverlap: false, // Prevent selecting over existing events
        selectConstraint: 'businessHours', // Only allow selection during business hours
        dayMaxEvents: true,
        weekends: true,
        nowIndicator: true,

        now: function() {
            // Use Eastern Daylight Time (EDT) timezone
            const now = new Date();
            const edtOffset = -4 * 60; // EDT is UTC-4
            const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
            const edtTime = new Date(utc + (edtOffset * 60000));
            return edtTime;
        },
        // Drag and drop settings
        eventStartEditable: true,   // Allow dragging to change start time
        eventDurationEditable: false, // Disable resizing to change duration
        eventOverlap: function(stillEvent, movingEvent) {
            // Allow overlap during drag, we'll check in the drop handler
            return true;
        },
        eventConstraint: 'businessHours', // Constrain events to business hours
        dragRevertDuration: 200,    // Animation duration when drag is reverted
        eventDragMinDistance: 5,    // Minimum pixels to start drag
        // eventDragOpacity removed (unsupported option in current FullCalendar build)
        eventResizableFromStart: false, // Disable resizing from start
        dragScroll: true,           // Enable auto-scroll during drag
        // Time format settings
        eventTimeFormat: { // Time format for events
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        },
        slotLabelFormat: { // Time format for axis labels
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        },
        selectAllow: function(selectInfo) {
            // Allow selection only during reasonable hours and duration
            const duration = (selectInfo.end - selectInfo.start) / (1000 * 60); // minutes
            const hour = selectInfo.start.getHours();
            
            // Prevent extremely short selections (less than 15 minutes)
            if (duration < 15) return false;
            
            // Prevent extremely long selections (more than 4 hours)
            if (duration > 240) return false;
            
            // Only allow during business hours
            return hour >= 9 && hour < 22;
        },
        businessHours: {
            startTime: currentSettings.workStartTime,
            endTime: currentSettings.workEndTime,
            daysOfWeek: currentSettings.workingDays
        },
        slotMinTime: '09:00:00',
        slotMaxTime: '22:30:00',
        slotDuration: '00:15:00',
        snapDuration: '00:15:00',
        views: {
            timeGridWeek: {
                dayHeaderFormat: { weekday: 'short' }
            },
            timeGridDay: {
                dayHeaderFormat: { weekday: 'short' }
            },
            dayGridMonth: {
                dayHeaderFormat: { weekday: 'short' }
            },
            listWeek: {
                // List view - no dragging, click only
                editable: false,
                eventStartEditable: false,
                eventDurationEditable: false,
                listDayFormat: { weekday: 'long', month: 'short', day: 'numeric' }
            },
            listMonth: {
                // List view - no dragging, click only
                editable: false,
                eventStartEditable: false,
                eventDurationEditable: false,
                listDayFormat: { weekday: 'long', month: 'short', day: 'numeric' }
            }
        },
        
        dateClick: function(dateClickInfo) {
            // Handle single clicks on calendar dates (especially for month view)
            console.log('Date clicked:', dateClickInfo.date, 'view:', calendar.view.type);
            
            // Check if we have clients first
            if (clients.length === 0) {
                showToast('Please add a client first before scheduling appointments', 'warning');
                return;
            }
            
            // Only handle dateClick for month view - other views use drag-to-select
            if (calendar.view.type === 'dayGridMonth') {
                // Set default appointment time to 10:00 AM if clicked time is before business hours
                const clickedDate = new Date(dateClickInfo.date);
                const hour = clickedDate.getHours();
                
                // If clicked on a day without time, or outside business hours, default to 10 AM
                if (hour < 9 || hour > 21) {
                    clickedDate.setHours(10, 0, 0, 0);
                }
                
                // Open appointment modal with the clicked date
                openAppointmentModal(null, clickedDate);
            }
        },
        
        select: function(selectInfo) {
            // Check if we have clients first
            if (clients.length === 0) {
                showToast('Please add a client first before scheduling appointments', 'warning');
                calendar.unselect();
                return;
            }
            
            // Calculate duration based on selection
            const selectedDuration = Math.round((selectInfo.end - selectInfo.start) / (1000 * 60));
            
            // Use minimum 15 minutes, maximum 4 hours
            const duration = Math.max(15, Math.min(240, selectedDuration));
            
            console.log('Calendar selection:', {
                start: selectInfo.start,
                end: selectInfo.end,
                duration: duration
            });
            
            // Create appointment with calculated duration
            const localStart = new Date(selectInfo.start);
            
            // For quick creation, auto-assign to first client if only one exists
            if (clients.length === 1) {
                const appointmentData = {
                    clientId: clients[0].id,
                    start: localStart,
                    end: new Date(localStart.getTime() + duration * 60000),
                    duration: duration,
                    priority: 'normal',
                    status: 'scheduled',
                    notes: 'Created by drag-to-create',
                    providerId: providers.length > 0 ? providers[0].id : ''
                };
                
                // Auto-create the appointment
                saveAppointment(appointmentData);
                showToast(`Appointment created for ${clients[0].name}`);
            } else {
                // Multiple clients - open modal for selection
                openAppointmentModal(null, localStart);
            }
            
            calendar.unselect(); // Clear the selection
        },
        
        eventClick: function(clickInfo) {
            console.log('Event clicked:', clickInfo.event);
            showAppointmentDetailsModal(clickInfo.event);
        },
        
        eventDrop: function(dropInfo) {
            console.log('Event dropped:', dropInfo);
            const appointment = dropInfo.event.extendedProps.appointment;
            let newStart = dropInfo.event.start;
            let newEnd = dropInfo.event.end;
            
            // List view dragging is disabled - this shouldn't happen
            if (calendar.view.type === 'listWeek' || calendar.view.type === 'listMonth') {
                dropInfo.revert();
                showToast('Dragging not available in list view. Click appointments to edit.', 'info');
                return;
            }
            
            // Regular grid view handling
            const overlaps = checkForOverlaps(newStart, newEnd, appointment.id);
            if (overlaps.length > 0) {
                // Revert the drag operation
                dropInfo.revert();
                const conflictClient = clients.find(c => c.id === overlaps[0].clientId)?.name || 'Unknown';
                showToast(`Cannot move appointment: conflicts with ${conflictClient} at ${overlaps[0].start.toLocaleTimeString()}`, 'error');
                return;
            }
            
            // Save the change
            const updatedAppointment = {
                ...appointment,
                start: newStart,
                end: newEnd
            };
            
            console.log('Saving updated appointment after drag:', updatedAppointment);
            saveAppointment(updatedAppointment);
            showToast('Appointment moved successfully');
        },
        
        // Resize functionality disabled - appointments can only be moved, not resized
        
        eventDidMount: function(info) {
            // Get client info for proper naming and coloring
            const clientId = info.event.extendedProps.clientId;
            const client = clients.find(c => c.id === clientId);
            const firstName = client ? client.name.split(' ')[0] : 'Unknown';
            const clientColor = client ? client.color : '#4f46e5';
            
            // Set CSS custom property for client color
            info.el.style.setProperty('--client-color', clientColor);
            
            // Enable dragging for grid views only, not list view
            const viewType = calendar.view.type;
            if (viewType === 'listWeek' || viewType === 'listMonth') {
                info.el.style.cursor = 'pointer'; // Click only cursor for list view
            } else {
                info.el.style.cursor = 'grab'; // Drag cursor for other views
            }
            
            // Debug logging
            console.log('📅 Event mounted:', firstName, 'editable:', info.event.editable, 'startEditable:', info.event.startEditable, 'durationEditable:', info.event.durationEditable);
            
            // Simple view-specific customizations
            const currentView = calendar.view.type;
            
            if (currentView === 'timeGridWeek') {
                // Weekly view: Show names on medium and large screens, hide on small screens
                const isSmallScreen = window.innerWidth < 768; // Tailwind md breakpoint
                
                if (isSmallScreen) {
                    // Small screens: Hide ALL text for clean color blocks
                    const titleEl = info.el.querySelector('.fc-event-title');
                    if (titleEl) {
                        titleEl.style.display = 'none';
                        titleEl.innerHTML = '';
                    }
                    const timeEl = info.el.querySelector('.fc-event-time');
                    if (timeEl) {
                        timeEl.style.display = 'none';
                        timeEl.innerHTML = '';
                    }
                    
                    // Hide any remaining text content
                    const allTextElements = info.el.querySelectorAll('*');
                    allTextElements.forEach(el => {
                        el.style.color = 'transparent';
                        el.style.fontSize = '0';
                    });
                    
                    // Remove all text nodes to ensure completely clean color blocks
                    const walker = document.createTreeWalker(
                        info.el,
                        NodeFilter.SHOW_TEXT,
                        null,
                        false
                    );
                    const textNodes = [];
                    let node;
                    while (node = walker.nextNode()) {
                        textNodes.push(node);
                    }
                    textNodes.forEach(node => node.remove());
                } else {
                    // Medium and large screens: Show client names with professional styling
                    const titleEl = info.el.querySelector('.fc-event-title');
                    if (titleEl) {
                        titleEl.style.color = 'white';
                        titleEl.style.fontSize = '12px';
                        titleEl.style.fontWeight = '600';
                        titleEl.style.textShadow = '0 1px 2px rgba(0,0,0,0.8), 0 0 1px rgba(0,0,0,0.6)';
                        titleEl.style.textAlign = 'center';
                        titleEl.style.padding = '2px';
                        titleEl.style.lineHeight = '1.2';
                    }
                    
                    // Hide time element in weekly view even on larger screens
                    const timeEl = info.el.querySelector('.fc-event-time');
                    if (timeEl) {
                        timeEl.style.display = 'none';
                    }
                }
                
            } else if (currentView === 'dayGridMonth') {
                // Month view: Convert to tiny dots
                info.el.innerHTML = '';
                info.el.style.width = '8px';
                info.el.style.height = '8px';
                info.el.style.borderRadius = '50%';
                info.el.style.margin = '1px';
                info.el.style.display = 'inline-block';
                
                // Hover effect for dots
                info.el.addEventListener('mouseenter', function() {
                    this.style.transform = 'scale(1.3)';
                });
                info.el.addEventListener('mouseleave', function() {
                    this.style.transform = 'scale(1)';
                });
            }
            
            // Day view: Let FullCalendar handle native display completely
            
            // List view: Click and hold drag with colored separator and fixed overflow
            if (currentView === 'listWeek' || currentView === 'listMonth') {
                // Find the client for this appointment
                const clientId = info.event.extendedProps.clientId;
                const client = clients.find(c => c.id === clientId);
                const clientColor = client ? client.color : '#4f46e5';
                
                // CRITICAL: Enable click and hold dragging
                info.el.style.setProperty('pointer-events', 'auto', 'important');
                info.el.style.setProperty('user-select', 'none', 'important');
                info.el.style.setProperty('touch-action', 'none', 'important');
                
                // Clean styling with proper layout - dynamic colors for dark mode
                const backgroundColor = isDarkMode ? '#374151' : '#ffffff';
                const borderColor = isDarkMode ? '#4b5563' : '#e5e7eb';
                
                info.el.style.setProperty('border-left', `6px solid ${clientColor}`, 'important');
                info.el.style.setProperty('background-color', backgroundColor, 'important');
                info.el.style.setProperty('border-radius', '8px', 'important');
                info.el.style.setProperty('margin', '8px 0', 'important');
                info.el.style.setProperty('padding', '12px 16px', 'important');
                const boxShadow = isDarkMode ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.1)';
                info.el.style.setProperty('box-shadow', boxShadow, 'important');
                info.el.style.setProperty('border', `1px solid ${borderColor}`, 'important');
                
                // Enhanced hover effects for dark mode
                info.el.addEventListener('mouseenter', function() {
                    if (isDarkMode) {
                        this.style.setProperty('background-color', '#000000', 'important');
                        this.style.setProperty('box-shadow', '0 4px 12px rgba(0,0,0,0.6)', 'important');
                        this.style.setProperty('color', '#ffffff', 'important');
                        
                        // Change text color for all child elements
                        const titleEl = this.querySelector('.fc-list-event-title');
                        const timeEl = this.querySelector('.fc-list-event-time');
                        if (titleEl) titleEl.style.setProperty('color', '#ffffff', 'important');
                        if (timeEl) timeEl.style.setProperty('color', '#ffffff', 'important');
                    } else {
                        this.style.setProperty('background-color', '#f9fafb', 'important');
                        this.style.setProperty('box-shadow', '0 4px 12px rgba(0,0,0,0.15)', 'important');
                    }
                });
                
                info.el.addEventListener('mouseleave', function() {
                    this.style.setProperty('background-color', backgroundColor, 'important');
                    this.style.setProperty('box-shadow', boxShadow, 'important');
                    
                    if (isDarkMode) {
                        this.style.setProperty('color', '#f9fafb', 'important');
                        
                        // Restore original text colors
                        const titleEl = this.querySelector('.fc-list-event-title');
                        const timeEl = this.querySelector('.fc-list-event-time');
                        if (titleEl) titleEl.style.setProperty('color', '#f9fafb', 'important');
                        if (timeEl) timeEl.style.setProperty('color', '#ffffff', 'important');
                    }
                });
                info.el.style.setProperty('cursor', 'pointer', 'important'); // Default pointer, changes to grab on hold
                info.el.style.setProperty('display', 'flex', 'important');
                info.el.style.setProperty('align-items', 'center', 'important');
                info.el.style.setProperty('min-width', '0', 'important'); // Allow flexbox shrinking
                
                // Time and title styling with overflow protection
                const timeEl = info.el.querySelector('.fc-list-event-time');
                const titleEl = info.el.querySelector('.fc-list-event-title');
                
                if (timeEl) {
                    timeEl.style.setProperty('background-color', clientColor, 'important');
                    timeEl.style.setProperty('color', 'white', 'important');
                    timeEl.style.setProperty('font-weight', '600', 'important');
                    timeEl.style.setProperty('padding', '6px 8px', 'important');
                    timeEl.style.setProperty('border-radius', '6px', 'important');
                    timeEl.style.setProperty('margin-right', '12px', 'important');
                    timeEl.style.setProperty('flex-shrink', '0', 'important');
                    timeEl.style.setProperty('white-space', 'nowrap', 'important');
                    timeEl.style.setProperty('font-size', '13px', 'important');
                    timeEl.style.setProperty('min-width', '150px', 'important');
                    timeEl.style.setProperty('width', '150px', 'important');
                    timeEl.style.setProperty('text-align', 'left', 'important');
                    timeEl.style.setProperty('padding-left', '8px', 'important');
                }
                
                if (titleEl) {
                    titleEl.textContent = getDisplayName(info.event.extendedProps.firstName || info.event.title);
                    
                    // Dynamic color based on dark mode
                    const textColor = isDarkMode ? '#f9fafb' : '#1f2937';
                    titleEl.style.setProperty('color', textColor, 'important');
                    titleEl.style.setProperty('font-weight', '600', 'important');
                    titleEl.style.setProperty('font-size', '15px', 'important');
                    titleEl.style.setProperty('overflow', 'hidden', 'important');
                    titleEl.style.setProperty('text-overflow', 'ellipsis', 'important');
                    titleEl.style.setProperty('white-space', 'nowrap', 'important');
                    titleEl.style.setProperty('flex', '1', 'important');
                    titleEl.style.setProperty('min-width', '0', 'important');
                }
                
                // Add click and hold behavior for dragging
                let holdTimer = null;
                let isDragReady = false;
                
                info.el.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    holdTimer = setTimeout(() => {
                        isDragReady = true;
                        this.style.cursor = 'grab';
                        this.style.transform = 'scale(1.02)';
                        this.style.boxShadow = '0 4px 12px rgba(0,123,255,0.3)';
                        // Enable FullCalendar dragging
                        info.event.setProp('startEditable', true);
                    }, 500); // 500ms hold requirement
                });
                
                info.el.addEventListener('mouseup', function(e) {
                    if (holdTimer) {
                        clearTimeout(holdTimer);
                        holdTimer = null;
                    }
                    if (!isDragReady) {
                        // Short click - show details modal
                        e.stopPropagation();
                        showAppointmentDetailsModal(info.event);
                    }
                    // Reset styles
                    this.style.cursor = 'pointer';
                    this.style.transform = 'scale(1)';
                    this.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                    isDragReady = false;
                });
                
                info.el.addEventListener('mouseleave', function() {
                    if (holdTimer) {
                        clearTimeout(holdTimer);
                        holdTimer = null;
                    }
                    this.style.cursor = 'pointer';
                    this.style.transform = 'scale(1)';
                    this.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                    isDragReady = false;
                });
            }
        },
        
        datesSet: function(dateInfo) {
            document.getElementById('calendar-title').textContent = dateInfo.view.title;
        },
        
        // Add visual feedback during drag operations
        eventMouseEnter: function(mouseEnterInfo) {
            // Add visual cue that event is draggable
            console.log('🖱️ Mouse entered event:', mouseEnterInfo.event.title);
            mouseEnterInfo.el.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
            mouseEnterInfo.el.style.cursor = 'grab';
        },
        
        eventMouseLeave: function(mouseLeaveInfo) {
            // Remove hover effect
            mouseLeaveInfo.el.style.boxShadow = '';
        },
        
        // Add drag start and end feedback
        eventDragStart: function(dragInfo) {
            console.log('🎯 DRAG STARTED! Event:', dragInfo.event.title, 'at', dragInfo.event.start);
            console.log('Drag element:', dragInfo.el);
            dragInfo.el.style.opacity = '0.6';
            dragInfo.el.style.transform = 'scale(1.05)';
            dragInfo.el.style.zIndex = '1000';
            dragInfo.el.style.boxShadow = '0 8px 16px rgba(0,123,255,0.4)';
        },
        
        eventDragStop: function(dragInfo) {
            console.log('Drag stopped:', dragInfo);
            dragInfo.el.style.opacity = '1';
            dragInfo.el.style.transform = 'scale(1)';
            dragInfo.el.style.zIndex = '';
        },
        
        // Resize event handlers removed - only drag functionality remains
        
        viewDidMount: function(view) {
            // List view settings
            if (view.view.type === 'listWeek' || view.view.type === 'listMonth') {
                console.log('📋 List view mounted');
            }
        }
    });
    
    calendar.render();
    

    
    // Standard initialization
    
    // Set initial active view button
    document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('bg-indigo-600', 'text-white'));
    const activeBtn = document.querySelector(`[data-view="${initialView}"]`);
    if (activeBtn) {
        activeBtn.classList.add('bg-indigo-600', 'text-white');
    }
    
    // Add swipe navigation for touch devices
    setupSwipeNavigation();
}

// Persistent AI Notes Chat (simple client-side history, server-side auth)
function initializeAiNotesChat() {
    const form = document.getElementById('ai-chat-form');
    const input = document.getElementById('ai-chat-input');
    const log = document.getElementById('ai-chat-log');
    const micBtn = document.getElementById('ai-chat-mic');
    if (!form || !input || !log) return;

    let convo = [];

    function appendMessage(role, content) {
        const wrapper = document.createElement('div');
        wrapper.className = role === 'user' ? 'text-right' : 'text-left';
        const bubble = document.createElement('div');
        bubble.className = role === 'user' ? 'inline-block bg-indigo-600 text-white px-3 py-2 rounded-lg' : 'inline-block bg-gray-100 text-gray-800 px-3 py-2 rounded-lg';
        bubble.textContent = content;
        wrapper.appendChild(bubble);
        log.appendChild(wrapper);
        log.scrollTop = log.scrollHeight;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = (input.value || '').trim();
        if (!text) return;
        appendMessage('user', text);
        input.value = '';

        try {
            let reply;
            
            // Use the new calendar management agent first
            if (window.aiAssistant) {
                reply = await window.aiAssistant.processCalendarCommand(text);
                
                // If response indicates calendar action was taken, refresh UI
                if (reply.includes('Created') || reply.includes('Deleted') || reply.includes('Added note') || reply.includes('Updated')) {
                    setTimeout(() => {
                        renderCalendarEvents();
                        renderClientsList();
                        updateWeeklySummary();
                    }, 500);
                }
            } else {
                // Fallback to regular chat if calendar agent not available
                const recent = convo.slice(-8);
                const messages = [
                    { role: 'system', content: 'You are a helpful calendar assistant for a therapy practice. You can create appointments, manage clients, and help with scheduling. Default provider is Alex. Keep responses concise and helpful.' },
                    ...recent,
                    { role: 'user', content: text }
                ];

                const user = auth?.currentUser;
                if (!user) throw new Error('Not authenticated');
                const token = await user.getIdToken();
                const resp = await fetch('/api/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify({ model: 'gpt-4o', messages, temperature: 0.7, max_tokens: 500 })
                });
                if (!resp.ok) {
                    const txt = await resp.text();
                    throw new Error(txt || `HTTP ${resp.status}`);
                }
                const data = await resp.json();
                reply = data.choices?.[0]?.message?.content || '...';
            }
            
            appendMessage('assistant', reply);
            const recent = convo.slice(-8);
            convo = [...recent, { role: 'user', content: text }, { role: 'assistant', content: reply }];
            
        } catch (err) {
            appendMessage('assistant', 'Sorry, I had trouble responding just now. Please try again.');
            console.error('AI chat error:', err);
        }
    });

    // One-tap mic with auto-stop on silence
    if (micBtn && navigator.mediaDevices && window.MediaRecorder) {
        let recorder = null;
        let chunks = [];
        let isRecording = false;
        let audioCtx = null, analyser = null, source = null, vadTimer = null, lastVoiceTs = 0;
        const SILENCE_MS = 1200, VAD_INTERVAL_MS = 100, AMP_THRESHOLD = 0.035;

        function setMicActive(active) {
            micBtn.classList.toggle('bg-red-600', active);
            micBtn.classList.toggle('text-white', active);
            micBtn.classList.toggle('bg-gray-100', !active);
            micBtn.classList.toggle('text-gray-800', !active);
        }

        function teardownAudio() {
            if (vadTimer) { clearTimeout(vadTimer); vadTimer = null; }
            try { source && source.disconnect(); } catch (_) {}
            try { analyser && analyser.disconnect(); } catch (_) {}
            try { audioCtx && audioCtx.close(); } catch (_) {}
            source = analyser = audioCtx = null;
        }

        function startVAD(stream) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                source = audioCtx.createMediaStreamSource(stream);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 1024;
                source.connect(analyser);
                const data = new Uint8Array(analyser.fftSize);
                lastVoiceTs = Date.now();
                const sample = () => {
                    analyser.getByteTimeDomainData(data);
                    let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
                    const rms = Math.sqrt(sum / data.length);
                    if (rms > AMP_THRESHOLD) lastVoiceTs = Date.now();
                    if (isRecording && Date.now() - lastVoiceTs > SILENCE_MS) { try { recorder && recorder.stop(); } catch(_){} return; }
                    vadTimer = setTimeout(sample, VAD_INTERVAL_MS);
                };
                sample();
            } catch (e) { console.warn('VAD init failed:', e); }
        }

        micBtn.addEventListener('click', async () => {
            try {
                if (!isRecording) {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                    chunks = [];
                    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
                    recorder.onstop = async () => {
                        try {
                            teardownAudio();
                            try { stream.getTracks().forEach(t => t.stop()); } catch(_){}
                            const blob = new Blob(chunks, { type: 'audio/webm' });
                            const file = new File([blob], `note_${Date.now()}.webm`, { type: 'audio/webm' });
                            const user = auth?.currentUser; if (!user) throw new Error('Not authenticated');
                            const token = await user.getIdToken();
                            const formData = new FormData();
                            formData.append('file', file);
                            formData.append('model', 'whisper-1');
                            formData.append('response_format', 'verbose_json');
                            const resp = await fetch('/api/transcribe', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
                            if (!resp.ok) { const t = await resp.text(); throw new Error(t || `HTTP ${resp.status}`); }
                            let transcriptText = '';
                            const ct = resp.headers.get('content-type') || '';
                            if (ct.includes('application/json')) { const d = await resp.json(); transcriptText = (d && (d.text || d.transcription || '')) || ''; }
                            else { transcriptText = (await resp.text()) || ''; }
                            if (transcriptText) { input.value = transcriptText.trim(); form.dispatchEvent(new Event('submit')); }
                        } catch (err) {
                            console.error('Mic transcribe error:', err); showToast('Could not transcribe note', 'error');
                        } finally { setMicActive(false); isRecording = false; }
                    };
                    recorder.start(); isRecording = true; setMicActive(true); startVAD(stream);
                } else { try { recorder.stop(); } catch(_){} }
            } catch (err) {
                console.error('Mic error:', err); showToast('Microphone unavailable', 'error'); setMicActive(false); isRecording = false;
            }
        });
    }
}

// Global animation state
let isAnimating = false;

// Swipe navigation functionality
function setupSwipeNavigation() {
    const calendarEl = document.getElementById('calendar');
    let startX = 0;
    let startY = 0;
    let endX = 0;
    let endY = 0;
    let startTime = 0;
    
    calendarEl.addEventListener('touchstart', function(e) {
        if (isAnimating) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
        
        // Add slight scale effect on touch start
        const fcEl = calendarEl.querySelector('.fc');
        if (fcEl) {
            fcEl.style.transform = 'scale(0.98)';
        }
    }, { passive: true });
    
    calendarEl.addEventListener('touchmove', function(e) {
        if (isAnimating) return;
        
        const currentX = e.touches[0].clientX;
        const deltaX = currentX - startX;
        const fcEl = calendarEl.querySelector('.fc');
        
        // Add subtle preview movement during swipe
        if (fcEl && Math.abs(deltaX) > 20) {
            const translateX = Math.max(-30, Math.min(30, deltaX * 0.3));
            fcEl.style.transform = `translateX(${translateX}px) scale(0.98)`;
        }
    }, { passive: true });
    
    calendarEl.addEventListener('touchend', function(e) {
        if (isAnimating) return;
        
        endX = e.changedTouches[0].clientX;
        endY = e.changedTouches[0].clientY;
        const endTime = Date.now();
        
        // Calculate swipe distance, direction, and velocity
        const deltaX = endX - startX;
        const deltaY = endY - startY;
        const deltaTime = endTime - startTime;
        const velocity = Math.abs(deltaX) / deltaTime;
        
        const minSwipeDistance = 50;
        const minVelocity = 0.3; // pixels per millisecond
        
        const fcEl = calendarEl.querySelector('.fc');
        if (fcEl) {
            // Reset transform first
            fcEl.style.transform = '';
        }
        
        // Only process horizontal swipes that are longer than vertical swipes
        const isHorizontalSwipe = Math.abs(deltaX) > Math.abs(deltaY) && 
                                  (Math.abs(deltaX) > minSwipeDistance || velocity > minVelocity);
        
        if (isHorizontalSwipe) {
            isAnimating = true;
            
            if (deltaX > 0) {
                // Swipe right - go to previous period with animation
                animateCalendarTransition('right', () => {
                    calendar.prev();
                });
            } else {
                // Swipe left - go to next period with animation
                animateCalendarTransition('left', () => {
                    calendar.next();
                });
            }
        }
    }, { passive: true });
}

function animateCalendarTransition(direction, callback) {
    const calendarEl = document.getElementById('calendar');
    const fcEl = calendarEl.querySelector('.fc');
    
    if (!fcEl) {
        if (callback) callback();
        isAnimating = false;
        return;
    }
    
    // Handle fade transition for view changes and "today" button
    if (direction === 'fade') {
        fcEl.style.transition = 'opacity 0.2s ease';
        fcEl.style.opacity = '0.3';
        
        setTimeout(() => {
            if (callback) callback();
            fcEl.style.opacity = '1';
            
            setTimeout(() => {
                fcEl.style.transition = '';
                isAnimating = false;
            }, 200);
        }, 200);
        return;
    }
    
    // Handle sliding transitions for navigation
    isAnimating = true;
    const exitClass = direction === 'left' ? 'calendar-sliding-left' : 'calendar-sliding-right';
    
    // Ensure calendar container has proper overflow
    calendarEl.style.overflow = 'hidden';
    fcEl.classList.add(exitClass);
    
    // After exit animation completes, update calendar and add enter animation
    setTimeout(() => {
        fcEl.classList.remove(exitClass);
        
        // Execute the calendar change
        if (callback) callback();
        
        // Force a reflow to ensure the change is applied
        fcEl.offsetHeight;
        
        // Add enter animation
        const enterClass = direction === 'left' ? 'calendar-sliding-in-right' : 'calendar-sliding-in-left';
        fcEl.classList.add(enterClass);
        
        // Clean up after enter animation
        setTimeout(() => {
            fcEl.classList.remove(enterClass);
            calendarEl.style.overflow = '';
            isAnimating = false;
        }, 300);
    }, 300);
}

// Event listeners
function setupEventListeners() {
    // Sidebar toggle
    elements.menuToggleBtn.addEventListener('click', () => {
        elements.sidebar.classList.toggle('open');
        elements.sidebarOverlay.classList.toggle('hidden');
    });
    
    elements.sidebarOverlay.addEventListener('click', () => {
        elements.sidebar.classList.remove('open');
        elements.sidebarOverlay.classList.add('hidden');
    });
    
    // Calendar navigation with animations
    elements.todayBtn.addEventListener('click', () => {
        animateCalendarTransition('fade', () => {
            calendar.today();
            
            // Switch to day view when clicking Today button
            if (calendar.view.type !== 'timeGridDay') {
                calendar.changeView('timeGridDay');
                // Update active view button
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('bg-indigo-600', 'text-white'));
                const dayBtn = document.querySelector('[data-view="timeGridDay"]');
                if (dayBtn) {
                    dayBtn.classList.add('bg-indigo-600', 'text-white');
                }
            }
        });
    });
    
    elements.prevBtn.addEventListener('click', () => {
        animateCalendarTransition('right', () => calendar.prev());
    });
    
    elements.nextBtn.addEventListener('click', () => {
        animateCalendarTransition('left', () => calendar.next());
    });
    
    // View switcher with smooth transitions
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            
            // Add smooth transition for view changes
            animateCalendarTransition('fade', () => {
                calendar.changeView(view);
                
                // Update active state
                document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('bg-indigo-600', 'text-white'));
                btn.classList.add('bg-indigo-600', 'text-white');
            });
        });
    });
    
    // Filter
    elements.clientFilter.addEventListener('change', () => {
        renderCalendarEvents();
        renderClientList();
    });
    
    // Modal buttons
    elements.addClientBtn.addEventListener('click', () => openClientModal());
    elements.newAppointmentBtn.addEventListener('click', () => openAppointmentModal());
    elements.settingsBtn.addEventListener('click', () => openSettingsModal());
    elements.analyticsBtn.addEventListener('click', () => openAnalyticsModal());
    elements.providersBtn.addEventListener('click', () => openProvidersModal());
    
    // Form submissions
    elements.clientForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const clientData = {
            id: document.getElementById('client-id').value || null,
            name: formData.get('client-name') || document.getElementById('client-name').value,
            email: formData.get('client-email') || document.getElementById('client-email').value,
            phone: formData.get('client-phone') || document.getElementById('client-phone').value,
            color: formData.get('client-color') || document.getElementById('client-color').value,
            notes: formData.get('client-notes') || document.getElementById('client-notes').value
        };
        
        await saveClient(clientData);
        closeClientModal();
    });
    
    elements.appointmentForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const startDateTime = parseDateTime(document.getElementById('appointment-start').value);
        const duration = parseInt(document.getElementById('appointment-duration').value);
        const endDateTime = new Date(startDateTime.getTime() + duration * 60000);
        
        const appointmentData = {
            id: document.getElementById('appointment-id').value || null,
            clientId: document.getElementById('appointment-client').value,
            providerId: document.getElementById('appointment-provider').value || null,
            start: startDateTime,
            end: endDateTime,
            duration: duration,
            priority: document.getElementById('appointment-priority').value,
            status: document.getElementById('appointment-status').value,
            notes: document.getElementById('appointment-notes').value,
            repeats: document.getElementById('appointment-repeats').value
        };
        
        await saveAppointment(appointmentData);
        closeAppointmentModal();
    });
    
    // Modal close buttons
    document.getElementById('cancel-client-btn').addEventListener('click', closeClientModal);
    document.getElementById('cancel-appointment-btn').addEventListener('click', closeAppointmentModal);
    document.getElementById('cancel-settings-btn').addEventListener('click', closeSettingsModal);
    document.getElementById('close-providers-btn').addEventListener('click', closeProvidersModal);
    document.getElementById('close-analytics-btn').addEventListener('click', closeAnalyticsModal);
    
    // Delete buttons
    document.getElementById('delete-client-btn').addEventListener('click', async () => {
        const clientId = document.getElementById('client-id').value;
        if (confirm('Are you sure you want to delete this client and all their appointments?')) {
            await deleteClient(clientId);
            closeClientModal();
        }
    });
    
    document.getElementById('delete-appointment-btn').addEventListener('click', async () => {
        const appointmentId = document.getElementById('appointment-id').value;
        if (confirm('Are you sure you want to delete this appointment?')) {
            await deleteAppointment(appointmentId);
            closeAppointmentModal();
        }
    });
    
    // Settings save
    document.getElementById('save-settings-btn').addEventListener('click', () => {
        currentSettings = {
            workStartTime: document.getElementById('work-start-time').value,
            workEndTime: document.getElementById('work-end-time').value,
            defaultDuration: parseInt(document.getElementById('default-duration').value),
            workingDays: [],
            autoReminders: document.getElementById('auto-reminders').checked,
            reminderTime: parseInt(document.getElementById('reminder-time').value)
        };
        
        // Get working days
        for (let i = 0; i < 7; i++) {
            if (document.getElementById(`work-day-${i}`).checked) {
                currentSettings.workingDays.push(i);
            }
        }
        
        // Update calendar business hours
        calendar.setOption('businessHours', {
            startTime: currentSettings.workStartTime,
            endTime: currentSettings.workEndTime,
            daysOfWeek: currentSettings.workingDays
        });
        
        closeSettingsModal();
        showToast('Settings saved successfully');
    });
    
    // Undo functionality removed - incompatible with Firebase real-time updates
    
    // Provider form handlers
    document.getElementById('add-provider-btn').addEventListener('click', () => openProviderModal());
    document.getElementById('cancel-provider-btn').addEventListener('click', closeProviderModal);
    
    document.getElementById('provider-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const providerData = {
            id: document.getElementById('provider-id').value || null,
            name: document.getElementById('provider-name').value,
            email: document.getElementById('provider-email').value,
            title: document.getElementById('provider-title').value,
            color: document.getElementById('provider-color').value
        };
        
        await saveProvider(providerData);
        closeProviderModal();
    });
    
    document.getElementById('delete-provider-btn').addEventListener('click', async () => {
        const providerId = document.getElementById('provider-id').value;
        if (confirm('Are you sure you want to delete this provider?')) {
            await deleteProvider(providerId);
            closeProviderModal();
        }
    });
    
    // Analytics period change
    document.getElementById('analytics-period').addEventListener('change', (e) => {
        updateAnalyticsDisplay(e.target.value);
    });
    
    // Handle window resize for mobile view switching
    window.addEventListener('resize', () => {
        const isMobile = window.innerWidth < 768;
        const currentView = calendar.view.type;
        
        // If switching to mobile and currently on month/list view, switch to week
        if (isMobile && (currentView === 'dayGridMonth' || currentView === 'listWeek')) {
            calendar.changeView('timeGridWeek');
            // Update active button
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('bg-indigo-600', 'text-white'));
            const weekBtn = document.querySelector('[data-view="timeGridWeek"]');
            if (weekBtn) {
                weekBtn.classList.add('bg-indigo-600', 'text-white');
            }
        }
        // If switching to desktop from mobile, default to month view
        else if (!isMobile && calendar.view.type === 'timeGridWeek' && window.innerWidth >= 768) {
            calendar.changeView('dayGridMonth');
            // Update active button
            document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('bg-indigo-600', 'text-white'));
            const monthBtn = document.querySelector('[data-view="dayGridMonth"]');
            if (monthBtn) {
                monthBtn.classList.add('bg-indigo-600', 'text-white');
            }
        }
    });
    
    // Duration preset buttons
    document.querySelectorAll('.duration-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const duration = btn.dataset.duration;
            document.getElementById('appointment-duration').value = duration;
            
            // Update visual states
            document.querySelectorAll('.duration-preset').forEach(b => {
                b.classList.remove('bg-indigo-600', 'text-white', 'border-indigo-600');
                b.classList.add('bg-gray-100', 'hover:bg-gray-200', 'border');
            });
            btn.classList.remove('bg-gray-100', 'hover:bg-gray-200', 'border');
            btn.classList.add('bg-indigo-600', 'text-white', 'border-indigo-600');
        });
    });
    
    // Dark Mode Toggle
    const darkModeBtn = document.getElementById('dark-mode-btn');
    if (darkModeBtn) {
        darkModeBtn.addEventListener('click', toggleDarkMode);
    }
    
    // Privacy Mode Toggle
    const privacyBtn = document.getElementById('privacy-btn');
    if (privacyBtn) {
        privacyBtn.addEventListener('click', togglePrivacyMode);
    }
    
    // Initialize modes from localStorage
    initializeModes();
    
    // Toggle sidebar button
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    if (toggleSidebarBtn) {
        toggleSidebarBtn.addEventListener('click', toggleSidebar);
    }

    // Voice-to-text for appointment notes
    const voiceNotesBtn = document.getElementById('voice-notes-btn');
    if (voiceNotesBtn) {
        let voiceNotesRecording = false;
        let voiceNotesRecognition = null;
        
        voiceNotesBtn.addEventListener('click', async () => {
            try {
                // Toggle recording state
                if (voiceNotesRecording) {
                    // Stop recording
                    if (voiceNotesRecognition) {
                        voiceNotesRecognition.stop();
                    }
                    return;
                }
                
                // Check if browser supports speech recognition
                if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
                    showToast('Speech recognition not supported in this browser', 'error');
                    return;
                }
                
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                voiceNotesRecognition = new SpeechRecognition();
                
                voiceNotesRecognition.continuous = true;
                voiceNotesRecognition.interimResults = true;
                voiceNotesRecognition.lang = 'en-US';
                
                const notesTextarea = document.getElementById('appointment-notes');
                
                // Change button state to indicate recording
                voiceNotesBtn.innerHTML = `
                    <span class="material-icons text-sm text-red-600 animate-pulse">stop</span>
                    <span class="text-red-600">Stop Recording</span>
                `;
                voiceNotesRecording = true;
                
                voiceNotesRecognition.onresult = (event) => {
                    let transcript = '';
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        if (event.results[i].isFinal) {
                            transcript += event.results[i][0].transcript + ' ';
                        }
                    }
                    
                    if (transcript) {
                        // Append to existing notes with proper spacing
                        const currentText = notesTextarea.value;
                        const newText = currentText ? currentText + '\n\n' + transcript.trim() : transcript.trim();
                        notesTextarea.value = newText;
                    }
                };
                
                voiceNotesRecognition.onerror = (event) => {
                    console.error('Speech recognition error:', event.error);
                    showToast('Speech recognition error: ' + event.error, 'error');
                    resetVoiceNotesButton();
                };
                
                voiceNotesRecognition.onend = () => {
                    resetVoiceNotesButton();
                };
                
                function resetVoiceNotesButton() {
                    voiceNotesBtn.innerHTML = `
                        <span class="material-icons text-sm">mic</span>
                        <span>Voice Notes</span>
                    `;
                    voiceNotesRecording = false;
                    voiceNotesRecognition = null;
                }
                
                voiceNotesRecognition.start();
                showToast('Voice recording started. Click "Stop Recording" when finished.', 'success');
                
            } catch (error) {
                console.error('Voice notes error:', error);
                showToast('Error starting voice recording: ' + error.message, 'error');
            }
        });
    }
    
    // Close modals when clicking outside
    [elements.clientModal, elements.appointmentModal, elements.settingsModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
            }
        });
    });
}

// Application initialization
async function initializeApp() {
    try {
        showLoading();
        
        // Initialize calendar
        initializeCalendar();
        
        // Setup event listeners
        setupEventListeners();
        
        // Wait for auth; use API backend if configured, else Firestore listeners
        onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            if (user && !dataListenersInitialized) {
                dataListenersInitialized = true;
                if (useApiBackend) {
                    await loadDataFromApi();
                } else {
        setupDataListeners();
                }
            }
        });
        
        // Set default view button active
        document.querySelector('[data-view="dayGridMonth"]').classList.add('bg-indigo-600', 'text-white');
        
        // Initialize AI Assistant
        initializeAIAssistant();
        
        // Initialize AI Notes Chat
        initializeAiNotesChat();

        // Initialize Voice Assistant
        initializeVoiceAssistant();
        
        hideLoading();
        showToast('Application loaded successfully');
        

    } catch (error) {
        console.error('Error initializing app:', error);
        showToast('Error loading application. Please refresh and try again.', 'error');
        hideLoading();
    }
}

// Start the application when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);

// Handle window resize for responsive design
window.addEventListener('resize', () => {
    if (calendar) {
        calendar.updateSize();
    }
});

// Handle visibility change to refresh data when user returns to tab
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && calendar) {
        calendar.refetchEvents();
    }
});

// AI Assistant Functions
function initializeAIAssistant() {
    // Make necessary functions available globally for AI agent
    window.saveAppointment = saveAppointment;
    window.saveClient = saveClient;
    window.deleteAppointment = deleteAppointment;
    window.appointments = appointments;
    window.clients = clients;
    window.providers = providers;
    
    // Initialize calendar management agent
    if (window.TherapyAIAssistant) {
        window.aiAssistant = new window.TherapyAIAssistant();
        console.log('AI Calendar Management Agent initialized');
    }
    
    // AI Assistant modal handlers
    if (elements.aiAssistantBtn) {
        elements.aiAssistantBtn.addEventListener('click', showAIAssistant);
    }
    
    const closeBtn = document.getElementById('close-ai-assistant-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', hideAIAssistant);
    }
    
    // AI feature buttons
    const featureButtons = [
        'ai-appointment-summary-btn',
        'ai-scheduling-optimization-btn', 
        'ai-practice-insights-btn',
        'ai-client-communication-btn',
        'ai-conflict-resolution-btn',
        'ai-session-analysis-btn'
    ];
    
    featureButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            const feature = btnId.replace('ai-', '').replace('-btn', '');
            btn.addEventListener('click', () => handleAIFeature(feature));
        }
    });
    
    // AI Notes analysis
    const analyzeNotesBtn = document.getElementById('ai-analyze-notes-btn');
    if (analyzeNotesBtn) {
        analyzeNotesBtn.addEventListener('click', analyzeSessionNotes);
    }
    
    const closeNotesBtn = document.getElementById('close-ai-notes-btn');
    if (closeNotesBtn) {
        closeNotesBtn.addEventListener('click', () => {
            document.getElementById('ai-notes-modal').classList.add('hidden');
        });
    }
    
    const notesCloseBtn = document.getElementById('ai-notes-close-btn');
    if (notesCloseBtn) {
        notesCloseBtn.addEventListener('click', () => {
            document.getElementById('ai-notes-modal').classList.add('hidden');
        });
    }
    
    // Client communication
    const generateMessageBtn = document.getElementById('ai-generate-message-btn');
    if (generateMessageBtn) {
        generateMessageBtn.addEventListener('click', generateClientMessage);
    }
    
    const newQueryBtn = document.getElementById('ai-new-query-btn');
    if (newQueryBtn) {
        newQueryBtn.addEventListener('click', resetAIInterface);
    }
}

function showAIAssistant() {
    populateAIClientSelect();
    document.getElementById('ai-assistant-modal').classList.remove('hidden');
}

function hideAIAssistant() {
    document.getElementById('ai-assistant-modal').classList.add('hidden');
    resetAIInterface();
}

function resetAIInterface() {
    const responseArea = document.getElementById('ai-response-area');
    const communicationForm = document.getElementById('ai-communication-form');
    
    if (responseArea) responseArea.classList.add('hidden');
    if (communicationForm) communicationForm.classList.add('hidden');
    
    const featureButtons = document.querySelectorAll('#ai-assistant-modal .grid button');
    featureButtons.forEach(btn => btn.classList.remove('hidden'));
}

function populateAIClientSelect() {
    const select = document.getElementById('ai-client-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">Select a client...</option>';
    clients.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = client.name;
        select.appendChild(option);
    });
}

async function handleAIFeature(feature) {
    const responseArea = document.getElementById('ai-response-area');
    const responseContent = document.getElementById('ai-response-content');
    const loading = document.getElementById('ai-loading');
    const communicationForm = document.getElementById('ai-communication-form');
    
    if (!responseArea || !responseContent || !loading) return;
    
    // Hide feature buttons and show loading
    const featureButtons = document.querySelectorAll('#ai-assistant-modal .grid button');
    featureButtons.forEach(btn => btn.classList.add('hidden'));
    
    if (feature === 'client-communication') {
        if (communicationForm) communicationForm.classList.remove('hidden');
        return;
    }
    
    responseArea.classList.remove('hidden');
    loading.classList.remove('hidden');
    responseContent.innerHTML = '';
    
    try {
        let result;
        
        switch (feature) {
            case 'appointment-summary':
                result = await aiAssistant.generateAppointmentSummary(appointments, clients, providers);
                displayAISummary(result);
                break;
                
            case 'scheduling-optimization':
                result = await aiAssistant.suggestOptimalScheduling(appointments, clients, {
                    start: currentSettings.workStartTime,
                    end: currentSettings.workEndTime
                });
                displaySchedulingOptimization(result);
                break;
                
            case 'practice-insights':
                const analyticsData = generateAnalyticsData();
                result = await aiAssistant.generatePracticeInsights(analyticsData);
                displayPracticeInsights(result);
                break;
                
            case 'conflict-resolution':
                const conflicts = findConflictingAppointments();
                if (conflicts.length === 0) {
                    responseContent.innerHTML = '<p class="text-gray-600">No scheduling conflicts detected at this time.</p>';
                } else {
                    result = await aiAssistant.suggestConflictResolution(conflicts, []);
                    displayConflictResolution(result);
                }
                break;
                
            case 'session-analysis':
                responseContent.innerHTML = '<p class="text-gray-600">Please use the "Analyze with AI" button in appointment forms to analyze specific session notes.</p>';
                break;
        }
    } catch (error) {
        console.error('AI Feature Error:', error);
        responseContent.innerHTML = `<div class="text-red-600 p-4 bg-red-50 rounded-lg">
            <p><strong>Error:</strong> ${error.message}</p>
            <p class="text-sm mt-2">This feature requires an OpenAI API key. Please check your environment configuration.</p>
        </div>`;
    } finally {
        loading.classList.add('hidden');
    }
}

function displayAISummary(result) {
    const content = document.getElementById('ai-response-content');
    if (!content) return;
    
    content.innerHTML = `
        <div class="space-y-4">
            <div class="bg-blue-50 p-4 rounded-lg">
                <h3 class="font-medium text-blue-900 mb-2">Summary</h3>
                <p class="text-blue-800">${result.summary || 'No summary available'}</p>
            </div>
            <div class="bg-green-50 p-4 rounded-lg">
                <h3 class="font-medium text-green-900 mb-2">Key Insights</h3>
                <p class="text-green-800">${result.insights || 'No insights available'}</p>
            </div>
            <div class="bg-yellow-50 p-4 rounded-lg">
                <h3 class="font-medium text-yellow-900 mb-2">Recommendations</h3>
                <p class="text-yellow-800">${result.recommendations || 'No recommendations available'}</p>
            </div>
        </div>
    `;
}

function displaySchedulingOptimization(result) {
    const content = document.getElementById('ai-response-content');
    if (!content) return;
    
    content.innerHTML = `
        <div class="space-y-4">
            <div class="bg-indigo-50 p-4 rounded-lg">
                <h3 class="font-medium text-indigo-900 mb-2">Peak Times</h3>
                <p class="text-indigo-800">${result.peakTimes || 'No peak time analysis available'}</p>
            </div>
            <div class="bg-green-50 p-4 rounded-lg">
                <h3 class="font-medium text-green-900 mb-2">Optimal Slots</h3>
                <p class="text-green-800">${result.optimalSlots || 'No optimal slots identified'}</p>
            </div>
            <div class="bg-yellow-50 p-4 rounded-lg">
                <h3 class="font-medium text-yellow-900 mb-2">Recommendations</h3>
                <p class="text-yellow-800">${result.recommendations || 'No recommendations available'}</p>
            </div>
        </div>
    `;
}

function displayPracticeInsights(result) {
    const content = document.getElementById('ai-response-content');
    if (!content) return;
    
    content.innerHTML = `
        <div class="space-y-4">
            <div class="bg-purple-50 p-4 rounded-lg">
                <h3 class="font-medium text-purple-900 mb-2">Performance</h3>
                <p class="text-purple-800">${result.performance || 'No performance data available'}</p>
            </div>
            <div class="bg-blue-50 p-4 rounded-lg">
                <h3 class="font-medium text-blue-900 mb-2">Client Retention</h3>
                <p class="text-blue-800">${result.retention || 'No retention insights available'}</p>
            </div>
            <div class="bg-green-50 p-4 rounded-lg">
                <h3 class="font-medium text-green-900 mb-2">Revenue Opportunities</h3>
                <p class="text-green-800">${result.revenue || 'No revenue insights available'}</p>
            </div>
            <div class="bg-yellow-50 p-4 rounded-lg">
                <h3 class="font-medium text-yellow-900 mb-2">Operations</h3>
                <p class="text-yellow-800">${result.operations || 'No operational insights available'}</p>
            </div>
        </div>
    `;
}

function displayConflictResolution(result) {
    const content = document.getElementById('ai-response-content');
    if (!content) return;
    
    content.innerHTML = `
        <div class="space-y-4">
            <div class="bg-red-50 p-4 rounded-lg">
                <h3 class="font-medium text-red-900 mb-2">Resolution Strategy</h3>
                <p class="text-red-800">${result.resolution || 'No resolution strategy available'}</p>
            </div>
            <div class="bg-blue-50 p-4 rounded-lg">
                <h3 class="font-medium text-blue-900 mb-2">Alternative Slots</h3>
                <p class="text-blue-800">${result.alternativeSlots || 'No alternative slots suggested'}</p>
            </div>
            <div class="bg-gray-50 p-4 rounded-lg">
                <h3 class="font-medium text-gray-900 mb-2">Reasoning</h3>
                <p class="text-gray-800">${result.reasoning || 'No reasoning provided'}</p>
            </div>
        </div>
    `;
}

async function analyzeSessionNotes() {
    const notes = document.getElementById('appointment-notes');
    if (!notes || !notes.value.trim()) {
        showToast('Please enter session notes before analyzing.', 'error');
        return;
    }
    
    const modal = document.getElementById('ai-notes-modal');
    const content = document.getElementById('ai-notes-content');
    
    if (!modal || !content) return;
    
    modal.classList.remove('hidden');
    content.innerHTML = '<div class="flex items-center space-x-2"><div class="animate-spin rounded-full h-4 w-4 border-b-2 border-indigo-600"></div><span>Analyzing session notes...</span></div>';
    
    try {
        const clientHistory = appointments.filter(apt => apt.status === 'completed').slice(-5);
        const result = await aiAssistant.analyzeSessionNotes(notes.value.trim(), clientHistory);
        
        content.innerHTML = `
            <div class="space-y-4">
                <div class="bg-blue-50 p-4 rounded-lg">
                    <h3 class="font-medium text-blue-900 mb-2">Key Themes</h3>
                    <p class="text-blue-800">${result.themes || 'No themes identified'}</p>
                </div>
                <div class="bg-green-50 p-4 rounded-lg">
                    <h3 class="font-medium text-green-900 mb-2">Progress Indicators</h3>
                    <p class="text-green-800">${result.progress || 'No progress indicators noted'}</p>
                </div>
                <div class="bg-yellow-50 p-4 rounded-lg">
                    <h3 class="font-medium text-yellow-900 mb-2">Follow-up Areas</h3>
                    <p class="text-yellow-800">${result.followUp || 'No specific follow-up areas identified'}</p>
                </div>
                <div class="bg-purple-50 p-4 rounded-lg">
                    <h3 class="font-medium text-purple-900 mb-2">Recommendations</h3>
                    <p class="text-purple-800">${result.recommendations || 'No specific recommendations'}</p>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Session analysis error:', error);
        content.innerHTML = `<div class="text-red-600 p-4 bg-red-50 rounded-lg">
            <p><strong>Error:</strong> ${error.message}</p>
            <p class="text-sm mt-2">This feature requires an OpenAI API key. Please check your environment configuration.</p>
        </div>`;
    }
}

async function generateClientMessage() {
    const clientSelect = document.getElementById('ai-client-select');
    const purposeSelect = document.getElementById('ai-message-purpose');
    
    if (!clientSelect || !purposeSelect) return;
    
    const clientId = clientSelect.value;
    const purpose = purposeSelect.value;
    
    if (!clientId) {
        showToast('Please select a client first.', 'error');
        return;
    }
    
    const client = clients.find(c => c.id === clientId);
    const clientAppointments = appointments.filter(apt => apt.clientId === clientId).slice(-3);
    
    const responseArea = document.getElementById('ai-response-area');
    const responseContent = document.getElementById('ai-response-content');
    const loading = document.getElementById('ai-loading');
    const communicationForm = document.getElementById('ai-communication-form');
    
    if (!responseArea || !responseContent || !loading || !communicationForm) return;
    
    communicationForm.classList.add('hidden');
    responseArea.classList.remove('hidden');
    loading.classList.remove('hidden');
    
    try {
        const result = await aiAssistant.generateClientCommunication(client, clientAppointments, purpose);
        
        responseContent.innerHTML = `
            <div class="space-y-4">
                <div class="bg-blue-50 p-4 rounded-lg">
                    <h3 class="font-medium text-blue-900 mb-2">Subject Line</h3>
                    <p class="text-blue-800 font-medium">${result.subject || 'No subject generated'}</p>
                </div>
                <div class="bg-green-50 p-4 rounded-lg">
                    <h3 class="font-medium text-green-900 mb-2">Message</h3>
                    <div class="text-green-800 whitespace-pre-line">${result.message || 'No message generated'}</div>
                </div>
                <div class="bg-gray-50 p-4 rounded-lg">
                    <h3 class="font-medium text-gray-900 mb-2">Tone</h3>
                    <p class="text-gray-800">${result.tone || 'Professional and empathetic'}</p>
                </div>
                <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
                    <p class="text-yellow-800 text-sm"><strong>Note:</strong> Please review and customize this message before sending to ensure it matches your communication style and therapeutic approach.</p>
                </div>
            </div>
        `;
    } catch (error) {
        console.error('Message generation error:', error);
        responseContent.innerHTML = `<div class="text-red-600 p-4 bg-red-50 rounded-lg">
            <p><strong>Error:</strong> ${error.message}</p>
            <p class="text-sm mt-2">This feature requires an OpenAI API key. Please check your environment configuration.</p>
        </div>`;
    } finally {
        loading.classList.add('hidden');
    }
}

function findConflictingAppointments() {
    const conflicts = [];
    for (let i = 0; i < appointments.length; i++) {
        for (let j = i + 1; j < appointments.length; j++) {
            const apt1 = appointments[i];
            const apt2 = appointments[j];
            if (apt1.providerId === apt2.providerId && 
                apt1.start.getTime() === apt2.start.getTime()) {
                conflicts.push({
                    ...apt1,
                    clientName: clients.find(c => c.id === apt1.clientId)?.name || 'Unknown'
                });
            }
        }
    }
    return conflicts;
}

function findOverlappingAppointments() {
    const overlaps = [];
    for (let i = 0; i < appointments.length; i++) {
        for (let j = i + 1; j < appointments.length; j++) {
            const apt1 = appointments[i];
            const apt2 = appointments[j];
            
            // Check if appointments overlap in time
            const apt1Start = new Date(apt1.start);
            const apt1End = new Date(apt1.end);
            const apt2Start = new Date(apt2.start);
            const apt2End = new Date(apt2.end);
            
            const hasOverlap = (apt1Start < apt2End && apt1End > apt2Start);
            
            if (hasOverlap) {
                overlaps.push({
                    apt1: apt1,
                    apt2: apt2,
                    overlapStart: new Date(Math.max(apt1Start.getTime(), apt2Start.getTime())),
                    overlapEnd: new Date(Math.min(apt1End.getTime(), apt2End.getTime()))
                });
            }
        }
    }
    return overlaps;
}

// Voice Assistant Functions
function initializeVoiceAssistant() {
    if (elements.voiceAssistantBtn) {
        elements.voiceAssistantBtn.addEventListener('click', toggleVoiceRecording);
    }
    

    
    // Continue conversation button in modal
    const modalContinueBtn = document.getElementById('continue-conversation-btn');
    if (modalContinueBtn) {
        modalContinueBtn.addEventListener('click', () => {
            console.log('Continue conversation clicked in modal');
            // Start voice recording in continue mode - this maintains conversation history
            if (voiceAssistant && typeof voiceAssistant.startContinueConversation === 'function') {
                voiceAssistant.startContinueConversation();
            } else {
                // Fallback to regular toggle but keep conversation context
                toggleVoiceRecording();
            }
        });
    }
    
    const closeVoiceBtn = document.getElementById('close-voice-modal-btn');
    if (closeVoiceBtn) {
        closeVoiceBtn.addEventListener('click', hideVoiceModal);
    }
    
    const voiceRecordBtn = document.getElementById('voice-record-btn');
    if (voiceRecordBtn) {
        voiceRecordBtn.addEventListener('click', toggleVoiceRecording);
    }
    
    // Listen for voice calendar actions
    window.addEventListener('voiceCalendarAction', handleVoiceCalendarAction);
    
    // Appointment confirmation buttons
    const confirmAppointmentBtn = document.getElementById('confirm-appointment-btn');
    if (confirmAppointmentBtn) {
        confirmAppointmentBtn.addEventListener('click', confirmVoiceAppointment);
    }
    
    // Cancel voice appointment confirmation event listener (different from regular appointment modal)
    const cancelVoiceAppointmentBtn = document.getElementById('cancel-voice-appointment-btn');
    if (cancelVoiceAppointmentBtn) {
        cancelVoiceAppointmentBtn.addEventListener('click', cancelVoiceAppointment);
    }
    
    // AI Response popup functionality
    const popupResponseBtn = document.getElementById('popup-response-btn');
    if (popupResponseBtn) {
        popupResponseBtn.addEventListener('click', showAIResponsePopup);
    }
    
    const closePopupBtn = document.getElementById('close-popup-btn');
    if (closePopupBtn) {
        closePopupBtn.addEventListener('click', hideAIResponsePopup);
    }
    
    const closePopupFooterBtn = document.getElementById('close-popup-footer-btn');
    if (closePopupFooterBtn) {
        closePopupFooterBtn.addEventListener('click', hideAIResponsePopup);
    }
    
    const copyResponseBtn = document.getElementById('copy-response-btn');
    if (copyResponseBtn) {
        copyResponseBtn.addEventListener('click', copyAIResponse);
    }
    
    // Close popup on backdrop click
    const aiResponsePopup = document.getElementById('ai-response-popup');
    if (aiResponsePopup) {
        aiResponsePopup.addEventListener('click', (e) => {
            if (e.target === aiResponsePopup) {
                hideAIResponsePopup();
            }
        });
    }
    
    // Appointment details modal event listeners
    const closeDetailsModal = document.getElementById('close-details-modal');
    if (closeDetailsModal) {
        closeDetailsModal.addEventListener('click', closeAppointmentDetailsModal);
    }
    
    const editAppointmentDetailsBtn = document.getElementById('edit-appointment-details-btn');
    if (editAppointmentDetailsBtn) {
        console.log('Edit appointment details button found, adding event listener');
        editAppointmentDetailsBtn.addEventListener('click', (e) => {
            console.log('Edit details button click event triggered');
            e.preventDefault();
            e.stopPropagation();
            editAppointmentFromDetails();
        });
    } else {
        console.error('Edit appointment details button not found!');
    }
    
    const deleteAppointmentDetailsBtn = document.getElementById('delete-appointment-details-btn');
    if (deleteAppointmentDetailsBtn) {
        console.log('Delete appointment details button found, adding event listener');
        deleteAppointmentDetailsBtn.addEventListener('click', (e) => {
            console.log('Delete details button click event triggered');
            e.preventDefault();
            e.stopPropagation();
            deleteAppointmentFromDetails();
        });
    } else {
        console.error('Delete appointment details button not found!');
    }
}

function toggleVoiceRecording() {
    // Show voice modal first if not already visible
    const modal = document.getElementById('voice-assistant-modal');
    if (modal && modal.classList.contains('hidden')) {
        showVoiceModal();
        return; // Just show modal, don't start recording yet
    }
    
    if (voiceAssistant.isRecording) {
        stopVoiceRecording();
    } else {
        // Only start recording if we're not already processing
        if (!voiceAssistant.isProcessing) {
            startVoiceRecording();
        } else {
            console.log('Voice assistant is already processing, ignoring recording request');
        }
    }
}

// Make toggleVoiceRecording available globally for AI assistant
window.toggleVoiceRecording = toggleVoiceRecording;

// Add minimum recording time
let recordingStartTime = null;

async function startVoiceRecording() {
    try {
        // Enhanced browser compatibility checks
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support microphone access. Please use a modern browser like Chrome, Firefox, or Safari.');
        }
        
        if (!window.MediaRecorder) {
            throw new Error('Your browser does not support audio recording. Please update your browser.');
        }
        
        // Check microphone permissions first
        try {
            const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
            console.log('Microphone permission status:', permissionStatus.state);
            
            if (permissionStatus.state === 'denied') {
                throw new Error('Microphone access is blocked. Please check your browser settings and allow microphone access for this site.');
            }
        } catch (permError) {
            console.log('Permission query not supported, proceeding with direct access');
        }
        
        // Enhanced microphone detection and guidance
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            console.log('Available audio input devices:', audioInputs.length);
            console.log('Device details:', audioInputs.map(d => ({ 
                label: d.label || 'Unknown device', 
                deviceId: d.deviceId,
                groupId: d.groupId 
            })));
            
            if (audioInputs.length === 0) {
                throw new Error('No microphone found. Please check that your microphone is connected and enabled in your system settings.');
            }
            
            // Provide guidance on microphone selection
            const hasMultipleMics = audioInputs.length > 1;
            if (hasMultipleMics) {
                console.log('Multiple microphones detected - the system will try to use the best one automatically');
            }
        } catch (deviceError) {
            console.log('Device enumeration failed, proceeding with default microphone selection');
        }
        
        const success = await voiceAssistant.startRecording();
        if (success) {
            recordingStartTime = Date.now();
            updateVoiceUI('recording');
            updateAIIndicator('recording');
            // Modal should already be visible from toggleVoiceRecording
        }
    } catch (error) {
        console.error('Voice recording error:', error);
        
        // Enhanced error messages for common laptop issues
        let errorMessage = error.message;
        if (error.name === 'NotAllowedError') {
            errorMessage = 'Microphone access denied. Please click the microphone icon in your browser\'s address bar and allow access, then try again.';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No microphone detected. Please check that your microphone is connected and not being used by another application.';
        } else if (error.name === 'NotReadableError') {
            errorMessage = 'Microphone is busy or not accessible. Please close other applications using the microphone and try again.';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage = 'Microphone settings conflict. This might be due to your laptop\'s microphone capabilities. Trying with default settings...';
        }
        
        showToast(errorMessage, 'error');
        updateVoiceUI('error', { response: { response: errorMessage } });
        updateAIIndicator('idle');
    }
}

function stopVoiceRecording() {
    if (!voiceAssistant.isRecording) {
        console.log('Not currently recording');
        return;
    }
    
    // Check if user recorded for at least 1 second
    const recordingDuration = Date.now() - recordingStartTime;
    if (recordingDuration < 1000) {
        showToast('Please record for at least 1 second. Try holding the button longer.', 'error');
        return;
    }
    
    voiceAssistant.stopRecording();
    updateVoiceUI('processing');
    updateAIIndicator('processing');
    
    // Add a longer delay to ensure all audio data is captured
    setTimeout(() => {
        // Manually trigger processing since we disabled auto-processing
        voiceAssistant.processRecording().then(result => {
            console.log('Voice processing successful:', result);
            updateVoiceUI('complete', result);
            updateAIIndicator('complete');
        }).catch(error => {
            console.error('Voice processing error:', error);
            updateVoiceUI('error', { response: { response: error.message } });
            updateAIIndicator('idle');
            showToast('Voice processing failed: ' + error.message, 'error');
        }).finally(() => {
            // Reset recording state
            recordingStartTime = null;
        });
    }, 1500); // Increased delay to 1.5 seconds for better audio capture
}

function updateVoiceUI(state, data = null) {
    // Focus on the modal elements only - remove references to header voice icon
    const statusDisplay = document.getElementById('voice-status-display');
    const recordBtn = document.getElementById('voice-record-btn');
    const recordIcon = document.getElementById('voice-record-icon');
    const loading = document.getElementById('voice-loading');
    const transcript = document.getElementById('voice-transcript');
    const response = document.getElementById('voice-response');
    
    if (!statusDisplay || !recordBtn || !recordIcon) return;
    
    // Reset classes
    recordBtn.classList.remove('bg-red-100', 'bg-green-100', 'bg-gray-100');
    recordIcon.classList.remove('text-red-600', 'text-green-600', 'text-gray-600');
    
    switch (state) {
        case 'idle':
            statusDisplay.textContent = 'Tap the microphone to start';
            recordBtn.classList.add('bg-gray-100');
            recordIcon.classList.add('text-gray-600');
            recordIcon.textContent = 'mic';
            if (loading) loading.classList.add('hidden');
            if (transcript) transcript.classList.add('hidden');
            if (response) response.classList.add('hidden');
            
            // Hide continue conversation button in idle state
            const idleContinueBtn = document.getElementById('continue-conversation-btn');
            if (idleContinueBtn) {
                idleContinueBtn.classList.add('hidden');
            }
            break;
            
        case 'recording':
            statusDisplay.textContent = 'Recording... Speak LOUDLY and CLEARLY for 3+ seconds';
            recordBtn.classList.add('bg-red-100');
            recordIcon.classList.add('text-red-600');
            recordIcon.textContent = 'stop';
            if (loading) loading.classList.add('hidden');
            if (transcript) transcript.classList.add('hidden');
            if (response) response.classList.add('hidden');
            
            // Hide continue conversation button while recording
            const recordingContinueBtn = document.getElementById('continue-conversation-btn');
            if (recordingContinueBtn) {
                recordingContinueBtn.classList.add('hidden');
            }
            break;
            
        case 'processing':
            statusDisplay.textContent = 'Processing...';
            recordBtn.classList.add('bg-green-100');
            recordIcon.classList.add('text-green-600');
            recordIcon.textContent = 'mic';
            if (loading) loading.classList.remove('hidden');
            
            // Hide continue conversation button while processing
            const processingContinueBtn = document.getElementById('continue-conversation-btn');
            if (processingContinueBtn) {
                processingContinueBtn.classList.add('hidden');
            }
            break;
            
        case 'complete':
            statusDisplay.textContent = 'Tap to record again or continue conversation';
            recordBtn.classList.add('bg-gray-100');
            recordIcon.classList.add('text-gray-600');
            recordIcon.textContent = 'mic';
            if (loading) loading.classList.add('hidden');
            
            // Show continue conversation button after completing a response
            const completeContinueBtn = document.getElementById('continue-conversation-btn');
            if (completeContinueBtn) {
                completeContinueBtn.classList.remove('hidden');
            }
            
            if (data && transcript && response) {
                if (data.transcript) {
                    document.getElementById('transcript-text').textContent = data.transcript;
                    transcript.classList.remove('hidden');
                }
                if (data.response && data.response.response) {
                    const responseText = data.response.response;
                    document.getElementById('response-text').textContent = responseText;
                    response.classList.remove('hidden');
                    
                    // Show expand button for long responses (>500 characters)
                    const expandBtn = document.getElementById('popup-response-btn');
                    if (expandBtn) {
                        if (responseText.length > 500) {
                            expandBtn.classList.remove('hidden');
                        } else {
                            expandBtn.classList.add('hidden');
                        }
                    }
                }
                
                // Show appointment confirmation if needed
                if (data.response && data.response.needs_confirmation && data.response.action === 'schedule') {
                    showAppointmentConfirmation(data.response);
                }
            }
            break;
            
        case 'error':
            statusDisplay.textContent = 'Error - Tap to try again';
            recordBtn.classList.add('bg-gray-100');
            recordIcon.classList.add('text-gray-600');
            recordIcon.textContent = 'mic';
            if (loading) loading.classList.add('hidden');
            
            if (data && response) {
                document.getElementById('response-text').textContent = data.response.response || 'An error occurred';
                response.classList.remove('hidden');
            }
            break;
    }
}

function showVoiceModal() {
    const modal = document.getElementById('voice-assistant-modal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

function hideVoiceModal() {
    const modal = document.getElementById('voice-assistant-modal');
    if (modal) {
        modal.classList.add('hidden');
    }
    
    // Stop recording if active
    if (voiceAssistant.isRecording) {
        voiceAssistant.stopRecording();
        voiceAssistant.isRecording = false; // Ensure state is reset
    }
    
    // Reset continue conversation button
    const resetContinueBtn = document.getElementById('continue-conversation-btn');
    if (resetContinueBtn) {
        resetContinueBtn.classList.add('hidden');
        resetContinueBtn.style.backgroundColor = '';
        resetContinueBtn.style.color = '';
    }
    
    // Reset UI to initial state
    updateVoiceUI('idle');
    updateAIIndicator('idle');
    
    // Hide appointment confirmation
    const appointmentConfirmation = document.getElementById('appointment-confirmation');
    if (appointmentConfirmation) {
        appointmentConfirmation.classList.add('hidden');
    }
}

// AI Indicator management
function updateAIIndicator(state) {
    const voiceBtn = document.getElementById('voice-assistant-btn');
    if (!voiceBtn) return;
    
    // Remove all state classes
    voiceBtn.classList.remove('recording', 'processing', 'complete');
    
    // Add appropriate state class
    switch (state) {
        case 'recording':
            voiceBtn.classList.add('recording');
            break;
        case 'processing':
            voiceBtn.classList.add('processing');
            break;
        case 'complete':
            voiceBtn.classList.add('complete');
            // Auto-reset to idle after 3 seconds
            setTimeout(() => {
                if (voiceBtn.classList.contains('complete')) {
                    voiceBtn.classList.remove('complete');
                }
            }, 3000);
            break;
        case 'idle':
        default:
            // No additional classes needed for idle state
            break;
    }
}

// Store pending appointment data for confirmation
let pendingVoiceAppointment = null;

// Check for appointment overlaps during voice confirmation
async function checkVoiceAppointmentOverlap(params) {
    console.log('=== CHECKING VOICE APPOINTMENT OVERLAP ===');
    console.log('Checking overlap for params:', params);
    console.log('Current appointments count:', appointments.length);
    
    // Parse the voice appointment parameters to get start and end times
    const clientName = params.clientName || params.client_name || params.name;
    const date = params.date;
    const time = params.time;
    const duration = params.duration || 60; // Changed default to 60 minutes
    
    console.log('Parsed parameters:', { clientName, date, time, duration });
    
    // Parse date using the reliable parseRelativeDate function
    let appointmentDate = parseRelativeDate(date);
    console.log('parseRelativeDate result for "' + date + '":', appointmentDate ? appointmentDate.toDateString() : 'null');
    
    // If parseRelativeDate couldn't parse it, try as a regular date
    if (!appointmentDate) {
        appointmentDate = new Date(date);
        if (isNaN(appointmentDate.getTime())) {
            console.error('Invalid date format:', date);
            return null;
        }
    }
    
    // Parse time - handle various formats
    let timeString = time.toString().toLowerCase().trim();
    console.log('Parsing time string:', timeString);
    
    // Handle different time formats
    let hours, minutes = 0;
    
    // Try different time formats
    if (timeString.includes('pm') || timeString.includes('am')) {
        const timeMatch = timeString.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)/i);
        if (timeMatch) {
            hours = parseInt(timeMatch[1]);
            minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            const ampm = timeMatch[3].toLowerCase();
            
            if (ampm === 'pm' && hours !== 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;
        }
    } else if (timeString.includes(':')) {
        const timeMatch = timeString.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
            hours = parseInt(timeMatch[1]);
            minutes = parseInt(timeMatch[2]);
        }
    } else {
        // Just a number, assume it's the hour
        hours = parseInt(timeString);
        if (hours > 12) {
            // Already in 24-hour format
        } else {
            // Assume PM for afternoon hours
            if (hours < 9) hours += 12;
        }
    }
    
    if (isNaN(hours) || hours < 0 || hours > 23) {
        console.error('Invalid time format:', time);
        return null;
    }
    
    appointmentDate.setHours(hours, minutes, 0, 0);
    const endTime = new Date(appointmentDate.getTime() + duration * 60000);
    
    console.log('Voice appointment time range:', appointmentDate.toLocaleString(), 'to', endTime.toLocaleString());
    
    // Check for overlaps with existing appointments
    for (const existingAppt of appointments) {
        const existingStart = new Date(existingAppt.start);
        const existingEnd = new Date(existingAppt.end);
        
        console.log('Checking against existing appointment:', existingStart.toLocaleString(), 'to', existingEnd.toLocaleString());
        
        // Check if times overlap - more detailed logging
        const hasOverlap = (appointmentDate < existingEnd && endTime > existingStart);
        
        console.log('Overlap check:', {
            newStart: appointmentDate.toLocaleString(),
            newEnd: endTime.toLocaleString(),
            existingStart: existingStart.toLocaleString(), 
            existingEnd: existingEnd.toLocaleString(),
            hasOverlap: hasOverlap
        });
        
        if (hasOverlap) {
            const existingClient = clients.find(c => c.id === existingAppt.clientId);
            const overlap = {
                clientName: existingClient ? existingClient.name : 'Unknown Client',
                timeRange: `${existingStart.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${existingEnd.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
            };
            console.log('OVERLAP DETECTED:', overlap);
            return overlap;
        }
    }
    
    console.log('No overlap found - appointment can be scheduled');
    return null; // No overlap found
}

function showAppointmentConfirmation(responseData) {
    console.log('Showing appointment confirmation for:', responseData);
    
    const confirmationDiv = document.getElementById('appointment-confirmation');
    const detailsDiv = document.getElementById('appointment-details');
    
    if (confirmationDiv && detailsDiv && responseData.parameters) {
        // Store the appointment data for later confirmation
        pendingVoiceAppointment = responseData.parameters;
        
        // Format and display appointment details
        updateAppointmentConfirmationDetails(responseData.parameters);
        confirmationDiv.classList.remove('hidden');
    }
}

function updateAppointmentConfirmationDetails(parameters) {
    const detailsDiv = document.getElementById('appointment-details');
    if (!detailsDiv) return;
    
    // Update pending appointment data when details change
    if (pendingVoiceAppointment) {
        pendingVoiceAppointment = { ...pendingVoiceAppointment, ...parameters };
        console.log('Updated pending voice appointment:', pendingVoiceAppointment);
    }
    
    // Format and display appointment details
    const details = [];
    if (parameters.client_name) details.push(`<strong>Client:</strong> ${parameters.client_name}`);
    if (parameters.date) details.push(`<strong>Date:</strong> ${parameters.date}`);
    if (parameters.time) details.push(`<strong>Time:</strong> ${parameters.time}`);
    if (parameters.provider) details.push(`<strong>Provider:</strong> ${parameters.provider}`);
    if (parameters.duration) details.push(`<strong>Duration:</strong> ${parameters.duration} minutes`);
    
    detailsDiv.innerHTML = details.join('<br>');
    console.log('Updated appointment confirmation details:', details);
}

async function confirmVoiceAppointment() {
    if (!pendingVoiceAppointment) {
        showToast('No appointment to confirm', 'error');
        return;
    }
    
    try {
        console.log('Confirming voice appointment:', pendingVoiceAppointment);
        
        // Check for overlaps before creating the appointment
        const overlap = await checkVoiceAppointmentOverlap(pendingVoiceAppointment);
        if (overlap) {
            showToast(`Cannot schedule: Overlaps with existing appointment for ${overlap.clientName} at ${overlap.timeRange}`, 'error');
            return;
        }
        
        await handleVoiceScheduleAppointment(pendingVoiceAppointment);
        
        // Hide confirmation and clear pending data
        const confirmationDiv = document.getElementById('appointment-confirmation');
        if (confirmationDiv) {
            confirmationDiv.classList.add('hidden');
        }
        pendingVoiceAppointment = null;
        
        showToast('Appointment created successfully!', 'success');
        
        // Firebase real-time listeners handle calendar updates automatically
        
    } catch (error) {
        console.error('Error confirming appointment:', error);
        console.error('Error stack:', error.stack);
        
        // Provide specific error messages based on the type of error
        let errorMessage = 'Error creating appointment';
        if (error.message) {
            if (error.message.includes('OpenAI')) {
                errorMessage = 'AI date parsing failed. Please try a simpler date format.';
            } else if (error.message.includes('Firebase')) {
                errorMessage = 'Database error. Please try again.';
            } else if (error.message.includes('overlap')) {
                errorMessage = 'Time slot conflict detected.';
            } else {
                errorMessage = `Error: ${error.message}`;
            }
        }
        
        showToast(errorMessage, 'error');
    }
}

function cancelVoiceAppointment() {
    // Hide confirmation and clear pending data
    const confirmationDiv = document.getElementById('appointment-confirmation');
    if (confirmationDiv) {
        confirmationDiv.classList.add('hidden');
    }
    pendingVoiceAppointment = null;
    
    showToast('Appointment cancelled', 'info');
}

// Voice reschedule confirmation system
let pendingVoiceReschedule = null;

function showVoiceRescheduleConfirmation(params) {
    console.log('Showing voice reschedule confirmation for:', params);
    
    // Find appointments matching the criteria
    let matchingAppointments = appointments.filter(apt => {
        const client = clients.find(c => c.id === apt.clientId);
        const clientMatch = client && params.clientName && 
               client.name.toLowerCase().includes(params.clientName.toLowerCase());
        
        // If date is specified, filter by date too
        if (params.originalDate && clientMatch) {
            const appointmentDate = new Date(apt.start);
            const targetDate = parseRelativeDate(params.originalDate);
            
            if (targetDate) {
                const targetStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
                const targetEnd = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);
                return appointmentDate >= targetStart && appointmentDate < targetEnd;
            }
        }
        
        return clientMatch;
    });
    
    if (matchingAppointments.length === 0) {
        showToast('No matching appointments found to reschedule', 'error');
        return;
    }
    
    const appointment = matchingAppointments[0];
    const client = clients.find(c => c.id === appointment.clientId);
    
    // Store for confirmation
    pendingVoiceReschedule = {
        appointmentId: appointment.id,
        newDate: params.newDate,
        newTime: params.newTime,
        clientName: client.name,
        originalStart: appointment.start
    };
    
    // Show unified yellow confirmation box in voice modal
    showVoiceConfirmationBox('reschedule', {
        title: 'Confirm Reschedule',
        message: `Move <strong>${client.name}</strong>'s appointment from:<br><strong>From:</strong> ${new Date(appointment.start).toLocaleString()}<br><strong>To:</strong> ${params.newDate} at ${params.newTime}`,
        confirmText: 'Confirm & Reschedule',
        confirmAction: 'confirmVoiceReschedule()',
        cancelAction: 'cancelVoiceReschedule()'
    });
}

async function confirmVoiceReschedule() {
    if (!pendingVoiceReschedule) {
        showToast('No reschedule operation to confirm', 'error');
        return;
    }
    
    try {
        await handleVoiceRescheduleAppointment(pendingVoiceReschedule);
        pendingVoiceReschedule = null;
        showToast('Appointment rescheduled successfully!', 'success');
        
        // Clear the confirmation in voice modal
        const responseDiv = document.getElementById('voice-response');
        if (responseDiv) {
            responseDiv.innerHTML = '<p class="text-green-600">Appointment rescheduled successfully!</p>';
        }
        
    } catch (error) {
        console.error('Error confirming reschedule:', error);
        showToast('Error rescheduling appointment: ' + error.message, 'error');
    }
}

function cancelVoiceReschedule() {
    pendingVoiceReschedule = null;
    cancelVoiceAction('Reschedule cancelled');
}

// Unified voice confirmation system
function showVoiceConfirmationBox(actionType, config) {
    const responseDiv = document.getElementById('voice-response');
    if (!responseDiv) return;
    
    responseDiv.innerHTML = `
        <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
            <h3 class="font-medium text-yellow-800 mb-2">${config.title}</h3>
            <p class="text-yellow-700 mb-3">${config.message}</p>
            <div class="flex space-x-2">
                <button onclick="${config.confirmAction}" class="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors">
                    ${config.confirmText}
                </button>
                <button onclick="${config.cancelAction}" class="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors">
                    Cancel
                </button>
            </div>
        </div>
    `;
}

function cancelVoiceAction(message = 'Action cancelled') {
    const responseDiv = document.getElementById('voice-response');
    if (responseDiv) {
        responseDiv.innerHTML = `<p class="text-gray-600">${message}</p>`;
    }
    showToast(message, 'info');
}

// Updated voice cancel/delete functions
async function actuallyVoiceCancelAppointment(appointmentId) {
    try {
        const appointment = appointments.find(apt => apt.id === appointmentId);
        if (!appointment) {
            throw new Error('Appointment not found');
        }
        
        const updatedAppointment = { ...appointment, status: 'cancelled' };
        await updateAppointment(appointmentId, updatedAppointment);
        
        const responseDiv = document.getElementById('voice-response');
        if (responseDiv) {
            responseDiv.innerHTML = '<p class="text-green-600">Appointment cancelled successfully!</p>';
        }
        
        showToast('Appointment cancelled successfully!', 'success');
        
        if (calendar) {
            calendar.refetchEvents();
            calendar.render();
        }
        
    } catch (error) {
        console.error('Error cancelling appointment:', error);
        showToast('Error cancelling appointment: ' + error.message, 'error');
    }
}

async function actuallyVoiceDeleteAppointment(appointmentId) {
    try {
        await deleteAppointment(appointmentId);
        
        const responseDiv = document.getElementById('voice-response');
        if (responseDiv) {
            responseDiv.innerHTML = '<p class="text-green-600">Appointment deleted successfully!</p>';
        }
        
        showToast('Appointment deleted successfully!', 'success');
        
    } catch (error) {
        console.error('Error deleting appointment:', error);
        showToast('Error deleting appointment: ' + error.message, 'error');
    }
}

async function handleVoiceRescheduleAppointment(params) {
    console.log('Handling voice reschedule appointment:', params);
    
    try {
        // Find the appointment to reschedule
        const appointmentId = params.appointmentId;
        const appointment = appointments.find(apt => apt.id === appointmentId);
        
        if (!appointment) {
            throw new Error('Appointment not found');
        }
        
        // Parse new date and time
        let newDate = parseRelativeDate(params.newDate);
        if (!newDate) {
            throw new Error('Invalid new date format');
        }
        
        // Parse new time
        const timeMatch = params.newTime.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
        if (!timeMatch) {
            throw new Error('Invalid new time format');
        }
        
        let hours = parseInt(timeMatch[1]);
        const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
        const ampm = timeMatch[3]?.toLowerCase();
        
        if (ampm === 'pm' && hours !== 12) hours += 12;
        if (ampm === 'am' && hours === 12) hours = 0;
        
        newDate.setHours(hours, minutes, 0, 0);
        
        // Calculate new end time
        const duration = appointment.duration || 50;
        const newEndDate = new Date(newDate.getTime() + duration * 60000);
        
        // Check for overlaps with the new time
        const hasOverlap = appointments.some(apt => {
            if (apt.id === appointmentId) return false; // Skip the appointment being rescheduled
            
            const aptStart = new Date(apt.start);
            const aptEnd = new Date(apt.end);
            
            return (newDate < aptEnd && newEndDate > aptStart);
        });
        
        if (hasOverlap) {
            throw new Error('New time slot conflicts with an existing appointment');
        }
        
        // Update the appointment
        const updatedAppointment = {
            ...appointment,
            start: newDate,
            end: newEndDate
        };
        
        await updateAppointment(appointmentId, updatedAppointment);
        
        // Force calendar refresh
        if (calendar) {
            calendar.refetchEvents();
            calendar.render();
        }
        
    } catch (error) {
        console.error('Error rescheduling appointment:', error);
        throw error;
    }
}

// AI Response Popup Functions
function showAIResponsePopup() {
    const responseText = document.getElementById('response-text');
    const popup = document.getElementById('ai-response-popup');
    const popupContent = document.getElementById('popup-response-content');
    
    if (responseText && popup && popupContent) {
        // Copy the response text to the popup
        popupContent.textContent = responseText.textContent;
        popup.classList.remove('hidden');
        
        // Focus the popup for keyboard navigation
        popup.focus();
    }
}

function hideAIResponsePopup() {
    const popup = document.getElementById('ai-response-popup');
    if (popup) {
        popup.classList.add('hidden');
    }
}

async function copyAIResponse() {
    const popupContent = document.getElementById('popup-response-content');
    if (popupContent) {
        try {
            await navigator.clipboard.writeText(popupContent.textContent);
            showToast('Response copied to clipboard', 'success');
        } catch (error) {
            console.error('Failed to copy text:', error);
            
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = popupContent.textContent;
            document.body.appendChild(textArea);
            textArea.select();
            
            try {
                document.execCommand('copy');
                showToast('Response copied to clipboard', 'success');
            } catch (fallbackError) {
                showToast('Copy failed - please select and copy manually', 'error');
            }
            
            document.body.removeChild(textArea);
        }
    }
}

// Removed old showVoiceDeleteConfirmation - replaced with unified showVoiceConfirmationBox system

// Helper function to calculate color brightness for optimal text contrast
function getColorBrightness(hexColor) {
    // Remove # if present
    const hex = hexColor.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    
    // Calculate brightness using luminance formula
    return (r * 299 + g * 587 + b * 114) / 1000;
}

function cancelVoiceDeletion() {
    const confirmationDiv = document.getElementById('voice-delete-confirmation');
    if (confirmationDiv) {
        confirmationDiv.classList.add('hidden');
    }
    pendingVoiceDeletion = null;
    showToast('Operation cancelled', 'info');
}

async function confirmVoiceDeletion() {
    if (!pendingVoiceDeletion) {
        showToast('No operation to confirm', 'error');
        return;
    }
    
    const { appointment, client, action } = pendingVoiceDeletion;
    
    try {
        if (action === 'delete') {
            await deleteAppointment(appointment.id);
            showToast(`Appointment deleted for ${client?.name || 'Unknown client'}`, 'success');
        } else if (action === 'cancel') {
            // Update appointment status to cancelled
            const updatedAppointment = {
                ...appointment,
                status: 'cancelled',
                updatedAt: new Date()
            };
            await updateAppointment(updatedAppointment);
            showToast(`Appointment cancelled for ${client?.name || 'Unknown client'}`, 'success');
        }
        
        // Hide confirmation and clear data
        const confirmationDiv = document.getElementById('voice-delete-confirmation');
        if (confirmationDiv) {
            confirmationDiv.classList.add('hidden');
        }
        pendingVoiceDeletion = null;
        
    } catch (error) {
        console.error(`Error ${action}ing appointment:`, error);
        showToast(`Error ${action}ing appointment: ${error.message}`, 'error');
    }
}

// Store current appointment being viewed in details modal
let currentDetailedAppointment = null;

// Store pending voice deletion data
let pendingVoiceDeletion = null;

// Simple, reliable date parsing function
function parseRelativeDate(dateString) {
    const today = new Date();
    const dateStr = dateString.toLowerCase().trim();
    
    // Simple cases
    if (dateStr === 'today') return new Date(today);
    if (dateStr === 'tomorrow') {
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        return tomorrow;
    }
    
    // Weekday parsing with clear, predictable rules
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    // "next [weekday]" - always next week (7+ days)
    const nextMatch = dateStr.match(/^next\s+(\w+)$/);
    if (nextMatch) {
        const dayIndex = weekdays.indexOf(nextMatch[1]);
        if (dayIndex !== -1) {
            const currentDay = today.getDay();
            const daysUntilTargetDay = (dayIndex - currentDay + 7) % 7;
            const daysToAdd = daysUntilTargetDay === 0 ? 7 : daysUntilTargetDay + 7; // Always next week
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + daysToAdd);
            return targetDate;
        }
    }
    
    // "this [weekday]" - this week only
    const thisMatch = dateStr.match(/^this\s+(\w+)$/);
    if (thisMatch) {
        const dayIndex = weekdays.indexOf(thisMatch[1]);
        if (dayIndex !== -1) {
            const currentDay = today.getDay();
            const daysUntilTargetDay = (dayIndex - currentDay + 7) % 7;
            if (daysUntilTargetDay === 0) return new Date(today); // Today
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + daysUntilTargetDay);
            return targetDate;
        }
    }
    
    // Plain weekday - next occurrence (this week if not passed, next week if passed)
    const dayIndex = weekdays.indexOf(dateStr);
    if (dayIndex !== -1) {
        const currentDay = today.getDay();
        const daysUntilTargetDay = (dayIndex - currentDay + 7) % 7;
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + daysUntilTargetDay);
        return targetDate;
    }
    
    // Try parsing as regular date
    const parsedDate = new Date(dateString);
    return !isNaN(parsedDate.getTime()) ? parsedDate : null;
}

// Fallback date parsing function
function fallbackDateParsing(dateString) {
    const today = new Date();
    const dateStr = dateString.toLowerCase().trim();
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    
    // "next [weekday]" - always next week
    const nextMatch = dateStr.match(/^next\s+(\w+)$/);
    if (nextMatch) {
        const dayIndex = weekdays.indexOf(nextMatch[1]);
        if (dayIndex !== -1) {
            const daysToAdd = (dayIndex - today.getDay() + 7) % 7 || 7;
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + daysToAdd);
            return targetDate;
        }
    }
    
    // "this [weekday]" - this week only
    const thisMatch = dateStr.match(/^this\s+(\w+)$/);
    if (thisMatch) {
        const dayIndex = weekdays.indexOf(thisMatch[1]);
        if (dayIndex !== -1) {
            const daysToAdd = dayIndex - today.getDay();
            if (daysToAdd < 0) return null;
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + daysToAdd);
            return targetDate;
        }
    }
    
    // Plain weekday - next occurrence
    const dayIndex = weekdays.indexOf(dateStr);
    if (dayIndex !== -1) {
        const daysToAdd = dayIndex - today.getDay();
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + (daysToAdd < 0 ? daysToAdd + 7 : daysToAdd));
        return targetDate;
    }
    
    // Try parsing as regular date
    const parsedDate = new Date(dateString);
    return !isNaN(parsedDate.getTime()) ? parsedDate : null;
}

function showAppointmentDetailsModal(calendarEvent) {
    console.log('Showing appointment details for:', calendarEvent);
    
    // Try to get appointment from calendar event first, then fallback to appointments array
    let appointment = null;
    
    if (calendarEvent.extendedProps && calendarEvent.extendedProps.appointment) {
        appointment = calendarEvent.extendedProps.appointment;
        console.log('Found appointment in extendedProps:', appointment);
    } else {
        // Find the full appointment data
        const appointmentId = calendarEvent.id;
        appointment = appointments.find(apt => apt.id === appointmentId);
        console.log('Found appointment in appointments array:', appointment);
    }
    
    if (!appointment) {
        console.error('Appointment not found for ID:', calendarEvent.id);
        return;
    }
    
    // Store the appointment with all necessary data
    currentDetailedAppointment = {
        id: appointment.id,
        clientId: appointment.clientId,
        providerId: appointment.providerId,
        start: appointment.start,
        end: appointment.end,
        duration: appointment.duration,
        status: appointment.status,
        notes: appointment.notes,
        priority: appointment.priority,
        repeats: appointment.repeats
    };
    
    console.log('Set currentDetailedAppointment:', currentDetailedAppointment);
    
    // Find client and provider info
    const client = clients.find(c => c.id === appointment.clientId);
    const provider = providers.find(p => p.id === appointment.providerId);
    
    // Populate modal content
    const contentDiv = document.getElementById('appointment-details-content');
    contentDiv.innerHTML = `
        <div class="space-y-3">
            <div class="flex items-center space-x-3">
                <span class="material-icons text-gray-500">person</span>
                <div>
                    <p class="text-sm text-gray-600">Client</p>
                    <p class="font-medium">${client ? client.name : 'Unknown Client'}</p>
                </div>
            </div>
            
            <div class="flex items-center space-x-3">
                <span class="material-icons text-gray-500">event</span>
                <div>
                    <p class="text-sm text-gray-600">Date & Time</p>
                    <p class="font-medium">${new Date(appointment.start).toLocaleDateString()} at ${new Date(appointment.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</p>
                </div>
            </div>
            
            <div class="flex items-center space-x-3">
                <span class="material-icons text-gray-500">schedule</span>
                <div>
                    <p class="text-sm text-gray-600">Duration</p>
                    <p class="font-medium">${appointment.duration} minutes</p>
                </div>
            </div>
            
            ${provider ? `
            <div class="flex items-center space-x-3">
                <span class="material-icons text-gray-500">medical_services</span>
                <div>
                    <p class="text-sm text-gray-600">Provider</p>
                    <p class="font-medium">${provider.name}</p>
                </div>
            </div>
            ` : ''}
            
            <div class="flex items-center space-x-3">
                <span class="material-icons text-gray-500">info</span>
                <div>
                    <p class="text-sm text-gray-600">Status</p>
                    <p class="font-medium capitalize">${appointment.status}</p>
                </div>
            </div>
            
            ${appointment.notes ? `
            <div class="flex items-start space-x-3">
                <span class="material-icons text-gray-500">notes</span>
                <div>
                    <p class="text-sm text-gray-600">Notes</p>
                    <p class="font-medium">${appointment.notes}</p>
                </div>
            </div>
            ` : ''}
        </div>
    `;
    
    // Show the modal
    document.getElementById('appointment-details-modal').classList.remove('hidden');
}

function closeAppointmentDetailsModal() {
    document.getElementById('appointment-details-modal').classList.add('hidden');
    currentDetailedAppointment = null;
}

function editAppointmentFromDetails() {
    console.log('Edit button clicked, currentDetailedAppointment:', currentDetailedAppointment);
    
    if (!currentDetailedAppointment) {
        console.error('currentDetailedAppointment is null');
        showToast('Error: No appointment data available', 'error');
        return;
    }
    
    if (!currentDetailedAppointment.id) {
        console.error('currentDetailedAppointment missing id:', currentDetailedAppointment);
        showToast('Error: Appointment ID missing', 'error');
        return;
    }
    
    console.log('Opening appointment modal for ID:', currentDetailedAppointment.id);
    const appointmentId = currentDetailedAppointment.id;
    closeAppointmentDetailsModal();
    openAppointmentModal(appointmentId);
}

async function deleteAppointmentFromDetails() {
    console.log('Delete button clicked, currentDetailedAppointment:', currentDetailedAppointment);
    
    if (!currentDetailedAppointment) {
        console.error('currentDetailedAppointment is null');
        showToast('Error: No appointment data available', 'error');
        return;
    }
    
    if (!currentDetailedAppointment.id) {
        console.error('currentDetailedAppointment missing id:', currentDetailedAppointment);
        showToast('Error: Appointment ID missing', 'error');
        return;
    }
    
    console.log('Confirming deletion for appointment ID:', currentDetailedAppointment.id);
    
    if (confirm('Are you sure you want to delete this appointment?')) {
        try {
            console.log('Calling deleteAppointment function...');
            const appointmentId = currentDetailedAppointment.id;
            closeAppointmentDetailsModal();
            await deleteAppointment(appointmentId);
            // Note: deleteAppointment already shows success toast and handles loading
        } catch (error) {
            console.error('Error deleting appointment from details:', error);
            showToast('Error deleting appointment: ' + error.message, 'error');
        }
    } else {
        console.log('User cancelled deletion');
    }
}

async function handleVoiceCalendarAction(event) {
    const actionData = event.detail;
    console.log('Handling voice calendar action:', actionData);
    
    try {
        switch (actionData.action) {
            case 'schedule':
                // For voice scheduling, show confirmation first
                showAppointmentConfirmation(actionData);
                break;
                
            case 'cancel':
                await handleVoiceCancelAppointment(actionData.parameters);
                break;
                
            case 'delete':
                await handleVoiceDeleteAppointment(actionData.parameters);
                break;
                
            case 'reschedule':
                // Convert reschedule to schedule action for consistency
                console.log('Converting reschedule to schedule action');
                showAppointmentConfirmation({
                    action: 'schedule',
                    parameters: {
                        client_name: actionData.parameters.client_name || actionData.parameters.clientName,
                        date: actionData.parameters.date || actionData.parameters.newDate,
                        time: actionData.parameters.time || actionData.parameters.newTime,
                        provider: actionData.parameters.provider || 'Alex',
                        duration: actionData.parameters.duration || 60
                    },
                    needs_confirmation: true
                });
                break;
                
            case 'view':
                handleVoiceViewCalendar(actionData.parameters);
                showToast('Voice command executed successfully');
                break;
                
            case 'add_client':
                handleVoiceAddClient(actionData.parameters);
                showToast('Voice command executed successfully');
                break;
                
            case 'search':
                handleVoiceSearchAppointments(actionData.parameters);
                showToast('Voice command executed successfully');
                break;
                
            case 'summary':
                handleVoiceShowSummary(actionData.parameters);
                showToast('Voice command executed successfully');
                break;
                
            case 'general_response':
                // For general responses, we don't need to execute any calendar actions
                // The response is already displayed in the voice modal
                console.log('General AI response provided:', actionData.response);
                break;
                
            case 'clarify':
                // No action needed, response already shows clarification request
                console.log('Clarification needed:', actionData.response);
                break;
                
            case 'error':
                console.log('Voice command error:', actionData.response);
                break;
                
            default:
                console.log('Voice action not implemented:', actionData.action);
                showToast('Voice command not recognized');
        }
        
    } catch (error) {
        console.error('Error executing voice command:', error);
        showToast('Error executing voice command: ' + error.message, 'error');
    }
}

async function handleVoiceScheduleAppointment(params) {
    console.log('=== VOICE APPOINTMENT CREATION START ===');
    console.log('Handling voice schedule appointment:', params);
    console.log('Current clients array length:', clients.length);
    
    // Extract parameters with more flexible naming
    const clientName = params.clientName || params.client_name || params.name;
    const date = params.date;
    const time = params.time;
    const providerName = params.provider || params.providerId;
    
    if (!clientName || !date || !time) {
        showToast('Missing information for scheduling appointment', 'error');
        return;
    }
    
    // Find or create client with improved name matching
    let client = findClientByFuzzyName(clientName);
    if (!client) {
        // For voice commands, auto-create the client if not found
        const newClient = {
            name: clientName,
            email: '',
            phone: '',
            notes: 'Created via voice command',
            color: '#4f46e5', // Default color
            createdAt: new Date()
        };
        
        try {
            console.log('Auto-creating client for voice command:', newClient);
            await saveClient(newClient);
            
            // Wait for Firebase to process and update local clients array
            // Find the newly created client in the updated clients array
            await new Promise(resolve => setTimeout(resolve, 500));
            client = findClientByFuzzyName(clientName);
            
            if (!client) {
                throw new Error('Client creation failed - not found in database after save');
            }
            
            console.log('Auto-created client successfully:', client);
        } catch (error) {
            console.error('Error creating client:', error);
            showToast(`Could not create client "${clientName}". Error: ${error.message}`, 'error');
            return;
        }
    }
    
    // Parse date using the reliable parseRelativeDate function
    console.log('Parsing date:', date, 'time:', time);
    let appointmentDate = parseRelativeDate(date);
    console.log('parseRelativeDate result for "' + date + '":', appointmentDate ? appointmentDate.toDateString() : 'null');
    
    // If parseRelativeDate couldn't parse it, try as a regular date
    if (!appointmentDate) {
        appointmentDate = new Date(date);
        if (isNaN(appointmentDate.getTime())) {
            console.error('Invalid date format:', date);
            showToast(`Invalid date format: ${date}`, 'error');
            return;
        }
    }
    
    // Parse and set the time
    if (time) {
        let hours, minutes = 0;
        
        // Handle AM/PM format
        const timeMatch = time.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
        if (timeMatch) {
            hours = parseInt(timeMatch[1]);
            minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
            const ampm = timeMatch[3]?.toLowerCase();
            
            // Convert to 24-hour format
            if (ampm === 'pm' && hours !== 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;
        } else if (time.includes(':')) {
            [hours, minutes] = time.split(':').map(t => parseInt(t));
        } else {
            hours = parseInt(time);
        }
        
        appointmentDate.setHours(hours, minutes, 0, 0);
        console.log('Time parsed and set to:', appointmentDate);
    }
    
    console.log('Final appointment date:', appointmentDate);
    
    if (isNaN(appointmentDate.getTime())) {
        console.error('Failed to parse date/time:', { date, time });
        showToast(`Invalid date or time format: ${date} ${time}`, 'error');
        return;
    }
    
    // Find provider by name if specified, default to Alex
    let providerId = '';
    if (providerName) {
        const provider = providers.find(p => p.name.toLowerCase().includes(providerName.toLowerCase()));
        if (provider) {
            providerId = provider.id;
        } else {
            // Try to find Alex as default
            const alexProvider = providers.find(p => p.name.toLowerCase().includes('alex'));
            providerId = alexProvider ? alexProvider.id : (providers.length > 0 ? providers[0].id : '');
        }
    } else {
        // Default to Alex if no provider specified
        const alexProvider = providers.find(p => p.name.toLowerCase().includes('alex'));
        providerId = alexProvider ? alexProvider.id : (providers.length > 0 ? providers[0].id : '');
    }
    
    // Validate appointment date is valid
    if (!appointmentDate || isNaN(appointmentDate.getTime())) {
        console.error('Invalid appointment date created:', appointmentDate);
        showToast('Invalid date or time - please try again', 'error');
        return;
    }
    
    // Create appointment - don't include ID, let Firebase generate it
    const appointment = {
        clientId: client.id,
        start: appointmentDate,
        end: new Date(appointmentDate.getTime() + (params.duration || 60) * 60000),
        title: `${client.name} - Therapy Session`,
        duration: params.duration || 60,
        providerId: providerId,
        status: 'scheduled',
        notes: params.notes || 'Scheduled via voice command'
    };
    
    // Final validation before saving
    if (!appointment.clientId || !appointment.start || !appointment.end) {
        console.error('Missing required appointment data:', appointment);
        showToast('Missing appointment information - please try again', 'error');
        return;
    }
    
    try {
        console.log('Attempting to save appointment:', appointment);
        console.log('Appointment start type:', typeof appointment.start, appointment.start);
        console.log('Appointment end type:', typeof appointment.end, appointment.end);
        console.log('Client ID:', appointment.clientId);
        console.log('Provider ID:', appointment.providerId);
        
        await saveAppointment(appointment);
        
        // Firebase real-time listeners handle calendar updates automatically
        console.log('Voice appointment saved to Firebase successfully');
        
        showToast(`Appointment scheduled for ${client.name} on ${appointmentDate.toLocaleDateString()} at ${appointmentDate.toLocaleTimeString()}`, 'success');
        console.log('=== VOICE APPOINTMENT CREATION COMPLETED ===');
        
    } catch (error) {
        console.error('Error saving voice appointment:', error);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            appointmentData: appointment
        });
        
        // Provide specific error message based on the error
        let errorMessage = 'Error scheduling appointment';
        if (error.message.includes('Client selection is required')) {
            errorMessage = 'Client information missing - please try again';
        } else if (error.message.includes('Start and end times are required')) {
            errorMessage = 'Invalid date or time format - please try again';
        } else if (error.message.includes('permission-denied')) {
            errorMessage = 'Database permission denied - please check connection';
        } else if (error.message && error.message.length > 0) {
            errorMessage = `Error: ${error.message}`;
        }
        
        showToast(errorMessage, 'error');
    }
}

async function handleVoiceCancelAppointment(params) {
    // Find appointments matching the criteria and date
    let matchingAppointments = appointments.filter(apt => {
        const client = clients.find(c => c.id === apt.clientId);
        const clientMatch = client && params.clientName && 
               client.name.toLowerCase().includes(params.clientName.toLowerCase());
        
        // If date is specified, filter by date too
        if (params.date && clientMatch) {
            const appointmentDate = new Date(apt.start);
            const targetDate = parseRelativeDate(params.date);
            
            if (targetDate) {
                const targetStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
                const targetEnd = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);
                return appointmentDate >= targetStart && appointmentDate < targetEnd;
            }
        }
        
        return clientMatch;
    });
    
    if (matchingAppointments.length === 0) {
        showToast('No matching appointments found to cancel', 'error');
        return;
    }
    
    // Show confirmation for deletion/cancellation
    const appointment = matchingAppointments[0];
    const client = clients.find(c => c.id === appointment.clientId);
    
    // Show unified yellow confirmation box for cancel
    showVoiceConfirmationBox('cancel', {
        title: 'Confirm Cancellation',
        message: `Cancel <strong>${client.name}</strong>'s appointment on ${new Date(appointment.start).toLocaleString()}?`,
        confirmText: 'Confirm & Cancel',
        confirmAction: `actuallyVoiceCancelAppointment('${appointment.id}')`,
        cancelAction: 'cancelVoiceAction()'
    });
}

async function handleVoiceDeleteAppointment(params) {
    // Find appointments matching the criteria and date
    let matchingAppointments = appointments.filter(apt => {
        const client = clients.find(c => c.id === apt.clientId);
        const clientMatch = client && params.clientName && 
               client.name.toLowerCase().includes(params.clientName.toLowerCase());
        
        // If date is specified, filter by date too
        if (params.date && clientMatch) {
            const appointmentDate = new Date(apt.start);
            const targetDate = parseRelativeDate(params.date);
            
            if (targetDate) {
                const targetStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
                const targetEnd = new Date(targetStart.getTime() + 24 * 60 * 60 * 1000);
                return appointmentDate >= targetStart && appointmentDate < targetEnd;
            }
        }
        
        return clientMatch;
    });
    
    if (matchingAppointments.length === 0) {
        showToast('No matching appointments found to delete', 'error');
        return;
    }
    
    // Show confirmation for deletion
    const appointment = matchingAppointments[0];
    const client = clients.find(c => c.id === appointment.clientId);
    
    // Show unified yellow confirmation box for delete
    showVoiceConfirmationBox('delete', {
        title: 'Confirm Deletion',
        message: `Permanently delete <strong>${client.name}</strong>'s appointment on ${new Date(appointment.start).toLocaleString()}?`,
        confirmText: 'Confirm & Delete',
        confirmAction: `actuallyVoiceDeleteAppointment('${appointment.id}')`,
        cancelAction: 'cancelVoiceAction()'
    });
}

function handleVoiceViewCalendar(params) {
    if (params.view) {
        const viewMap = {
            'month': 'dayGridMonth',
            'week': 'timeGridWeek', 
            'day': 'timeGridDay'
        };
        
        const view = viewMap[params.view.toLowerCase()];
        if (view && calendar) {
            calendar.changeView(view);
            showToast(`Switched to ${params.view} view`);
        }
    }
    
    if (params.date) {
        const targetDate = new Date(params.date);
        if (!isNaN(targetDate.getTime()) && calendar) {
            calendar.gotoDate(targetDate);
            showToast(`Navigated to ${targetDate.toLocaleDateString()}`);
        }
    }
}

function handleVoiceAddClient(params) {
    if (!params.name) {
        showToast('Client name is required', 'error');
        return;
    }
    
    // Open the client modal with pre-filled information
    showClientModal();
    document.getElementById('client-name').value = params.name || '';
    document.getElementById('client-email').value = params.email || '';
    document.getElementById('client-phone').value = params.phone || '';
    document.getElementById('client-notes').value = params.notes || '';
    
    showToast('Client form opened with voice input. Please review and save.');
}

function handleVoiceSearchAppointments(params) {
    if (params.clientName) {
        const clientFilter = document.getElementById('client-filter');
        if (clientFilter) {
            clientFilter.value = params.clientName;
            // Trigger filter event
            filterClients();
            showToast(`Filtered appointments for "${params.clientName}"`);
        }
    }
}

function handleVoiceShowSummary(params) {
    // Show analytics modal or weekly summary
    if (elements.analyticsBtn) {
        elements.analyticsBtn.click();
        showToast('Showing practice summary and analytics');
    }
}


