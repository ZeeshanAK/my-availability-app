import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, query, onSnapshot, addDoc, deleteDoc, updateDoc } from 'firebase/firestore';

// Context to provide Firebase instances and user ID throughout the app
const AppContext = createContext();

// Helper function to format date for display
const formatDate = (date, timeZone = 'UTC') => {
    return new Date(date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: timeZone
    });
};

// Helper function to format time for display
const formatTime = (date, timeZone = 'UTC') => {
    return new Date(date).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
        timeZone: timeZone
    });
};

// A simplified list of common time zones for the dropdown
const timeZones = [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Tokyo',
    'Australia/Sydney',
    'Pacific/Auckland',
    'UTC', // Universal Coordinated Time
];

// Weekday names for recurrence selection
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ShareView Component - For displaying a shared schedule
const ShareView = ({ db, appId }) => {
    const [sharedUserId, setSharedUserId] = useState(null);
    const [sharedDate, setSharedDate] = useState(null);
    const [sharedDisplayName, setSharedDisplayName] = useState('Loading...');
    const [sharedUserTimeZone, setSharedUserTimeZone] = useState('UTC'); // Original user's time zone
    const [viewerTimeZone, setViewerTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone); // Viewer's local time zone
    const [sharedScheduleEntries, setSharedScheduleEntries] = useState([]);
    const [loadingShare, setLoadingShare] = useState(true);
    const [shareError, setShareError] = useState(null);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const userIdFromUrl = params.get('userId');
        const dateFromUrl = params.get('date');

        if (!userIdFromUrl || !dateFromUrl) {
            setShareError("Invalid share link. User ID or date is missing.");
            setLoadingShare(false);
            return;
        }

        setSharedUserId(userIdFromUrl);
        setSharedDate(new Date(dateFromUrl));
    }, []);

    useEffect(() => {
        const fetchSharedData = async () => {
            if (!db || !sharedUserId || !sharedDate) return;

            setLoadingShare(true);
            setShareError(null);

            try {
                // Fetch shared user's profile
                const userProfileRef = doc(db, `artifacts/${appId}/users/${sharedUserId}/profile/userProfile`);
                const userProfileSnap = await getDoc(userProfileRef);
                if (userProfileSnap.exists()) {
                    const profileData = userProfileSnap.data();
                    setSharedDisplayName(profileData.displayName || 'Shared User');
                    setSharedUserTimeZone(profileData.timeZone || 'UTC'); // Fallback to UTC if not set
                } else {
                    setSharedDisplayName('Unknown User');
                    setSharedUserTimeZone('UTC');
                }

                // Fetch all schedule entries for the shared user
                const scheduleColRef = collection(db, `artifacts/${appId}/users/${sharedUserId}/schedules`);
                const q = query(scheduleColRef);

                const unsubscribe = onSnapshot(q, (snapshot) => {
                    const allEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    const currentDayOfWeek = sharedDate.getDay(); // 0 for Sunday, 6 for Saturday
                    const dateString = sharedDate.toISOString().split('T')[0];

                    const filteredEntries = allEntries.filter(entry => {
                        const entryStartDate = entry.recurrenceStartDate ? new Date(entry.recurrenceStartDate) : null;
                        const entryEndDate = entry.recurrenceEndDate ? new Date(entry.recurrenceEndDate) : null;
                        const selectedDateOnly = new Date(sharedDate.getFullYear(), sharedDate.getMonth(), sharedDate.getDate());

                        // Check if the selected date falls within the recurrence range
                        const isWithinRecurrenceRange = (!entryStartDate || selectedDateOnly >= entryStartDate) &&
                                                        (!entryEndDate || selectedDateOnly <= entryEndDate);

                        if (!isWithinRecurrenceRange) return false;

                        const isOneTime = entry.recurrenceType === 'none' && entry.date === dateString;
                        const isDailyRecurring = entry.recurrenceType === 'daily';
                        const isWeeklyRecurring = entry.recurrenceType === 'weekly' &&
                                                  entry.recurrenceDays &&
                                                  entry.recurrenceDays.includes(currentDayOfWeek);
                        return isOneTime || isDailyRecurring || isWeeklyRecurring;
                    }).sort((a, b) => {
                        const timeA = new Date(a.startDateTimeUTC);
                        const timeB = new Date(b.startDateTimeUTC);
                        return timeA - timeB;
                    });
                    setSharedScheduleEntries(filteredEntries);
                    setLoadingShare(false);
                }, (err) => {
                    console.error("Error fetching shared schedule entries:", err);
                    setShareError("Failed to load shared schedule.");
                    setLoadingShare(false);
                });

                return () => unsubscribe(); // Cleanup listener
            } catch (e) {
                console.error("Error fetching shared user data:", e);
                setShareError("Failed to load shared user data.");
                setLoadingShare(false);
            }
        };

        fetchSharedData();
    }, [db, appId, sharedUserId, sharedDate]);

    if (loadingShare) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-xl font-semibold text-gray-700">Loading shared schedule...</div>
            </div>
        );
    }

    if (shareError) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-red-100 text-red-700 p-4 rounded-lg">
                <p>{shareError}</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-100 font-sans text-gray-800 p-4">
            <header className="bg-white p-4 rounded-lg shadow-md mb-6">
                <h1 className="text-3xl font-bold text-gray-700">Schedule for {sharedDisplayName}</h1>
                <p className="text-gray-600">Viewing schedule for {formatDate(sharedDate, sharedUserTimeZone)}</p>
                <div className="flex items-center space-x-2 mt-4">
                    <label htmlFor="viewerTimeZoneSelect" className="text-gray-700 text-sm font-bold">View in:</label>
                    <select
                        id="viewerTimeZoneSelect"
                        className="shadow border rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        value={viewerTimeZone}
                        onChange={(e) => setViewerTimeZone(e.target.value)}
                    >
                        {timeZones.map(tz => (
                            <option key={tz} value={tz}>{tz}</option>
                        ))}
                    </select>
                </div>
            </header>

            <main className="bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-2xl font-semibold mb-4 text-gray-700">Scheduled Activities</h2>
                {sharedScheduleEntries.length === 0 ? (
                    <p className="text-gray-500">No schedule entries for this date.</p>
                ) : (
                    <ul className="space-y-3">
                        {sharedScheduleEntries.map(entry => (
                            <li key={entry.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-md shadow-sm border-l-4" style={{ borderColor: entry.activityColor }}>
                                <div>
                                    <span className="font-semibold text-gray-800">{entry.activityName}</span>
                                    <p className="text-sm text-gray-600">
                                        {formatTime(entry.startDateTimeUTC, viewerTimeZone)} - {formatTime(entry.endDateTimeUTC, viewerTimeZone)}
                                        {entry.recurrenceType !== 'none' && (
                                            <span className="ml-2 text-xs text-gray-500">
                                                ({entry.recurrenceType === 'daily' ? 'Daily' :
                                                  entry.recurrenceType === 'weekly' ? `Weekly on ${entry.recurrenceDays.map(d => weekdays[d].substring(0, 3)).join(', ')}` : ''})
                                                {entry.recurrenceStartDate && ` from ${entry.recurrenceStartDate}`}
                                                {entry.recurrenceEndDate && ` to ${entry.recurrenceEndDate}`}
                                            </span>
                                        )}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </main>
        </div>
    );
};


const App = () => {
    // State variables for Firebase instances and user authentication
    const [firebaseApp, setFirebaseApp] = useState(null);
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [displayName, setDisplayName] = useState(''); // New state for user's display name
    const [userTimeZone, setUserTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone); // User's selected time zone
    const [loading, setLoading] = useState(true); // Loading state for initial app setup
    const [error, setError] = useState(null); // State to display any errors

    // State for authentication forms
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [isLogin, setIsLogin] = useState(true); // Toggles between login and signup view

    // State for managing activity items
    const [activityItems, setActivityItems] = useState([]);
    const [newActivityName, setNewActivityName] = useState('');
    const [newActivityColor, setNewActivityColor] = useState('#000000'); // Default color for new activities

    // State for calendar and scheduling
    const [currentMonth, setCurrentMonth] = useState(new Date()); // Current month displayed in calendar
    const [selectedDate, setSelectedDate] = useState(new Date()); // Currently selected date
    const [scheduleEntries, setScheduleEntries] = useState([]); // Schedule entries for the selected date
    // New state to store all relevant schedules for the current month for dot indicators
    const [monthlyScheduleData, setMonthlyScheduleData] = useState(new Map()); // Stores 'YYYY-MM-DD' -> color string

    const [newScheduleStartTime, setNewScheduleStartTime] = useState('09:00'); // Default start time for new entry
    const [newScheduleEndTime, setNewScheduleEndTime] = useState('10:00'); // Default end time for new entry
    const [newScheduleActivityId, setNewScheduleActivityId] = useState(''); // Selected activity for new entry
    // New states for recurrence
    const [newScheduleRecurrenceType, setNewScheduleRecurrenceType] = useState('none'); // 'none', 'daily', 'weekly'
    const [newScheduleRecurrenceDays, setNewScheduleRecurrenceDays] = useState([]); // Array of numbers (0-6) for weekly recurrence
    const [newScheduleRecurrenceStartDate, setNewScheduleRecurrenceStartDate] = useState(new Date().toISOString().split('T')[0]); // Start date for recurrence
    const [newScheduleRecurrenceEndDate, setNewScheduleRecurrenceEndDate] = useState(''); // End date for recurrence

    // State for sharing functionality
    const [shareLink, setShareLink] = useState('');
    const [showShareModal, setShowShareModal] = useState(false);

    // Determine if we are in share view
    const isShareView = window.location.pathname.includes('/share');

    // useEffect hook to initialize Firebase and set up authentication listener
    useEffect(() => {
        // Only initialize if not in share view, as ShareView handles its own Firebase init
        if (isShareView) {
            // Initialize Firebase for the ShareView as well
            try {
                const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
                const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
                if (Object.keys(firebaseConfig).length === 0) {
                    console.error("Firebase config is missing for ShareView.");
                    setError("Firebase configuration error. Please contact support.");
                    setLoading(false);
                    return;
                }
                const app = initializeApp(firebaseConfig);
                setFirebaseApp(app);
                setDb(getFirestore(app));
                setLoading(false); // Done loading for share view
            } catch (e) {
                console.error("Failed to initialize Firebase for ShareView:", e);
                setError("Failed to initialize application for sharing. Please refresh.");
                setLoading(false);
            }
            return; // Exit early if in share view
        }

        try {
            // Retrieve app ID and Firebase config from global variables
            const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
            const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};

            // Check if Firebase config is provided
            if (Object.keys(firebaseConfig).length === 0) {
                console.error("Firebase config is missing. Please ensure __firebase_config is provided.");
                setError("Firebase configuration error. Please contact support.");
                setLoading(false);
                return;
            }

            // Initialize Firebase app, Firestore, and Auth services
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);

            // Set the initialized instances to state
            setFirebaseApp(app);
            setDb(firestore);
            setAuth(firebaseAuth);

            // Set up an authentication state change listener
            const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
                if (user) {
                    setUserId(user.uid);
                    // Fetch user profile data to get display name and time zone
                    const userProfileRef = doc(firestore, `artifacts/${appId}/users/${user.uid}/profile/userProfile`);
                    const userProfileSnap = await getDoc(userProfileRef);
                    if (userProfileSnap.exists()) {
                        const profileData = userProfileSnap.data();
                        setDisplayName(profileData.displayName || user.email);
                        setUserTimeZone(profileData.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);
                    } else {
                        // If no profile exists, create one with default display name (email) and detected time zone
                        const defaultDisplayName = user.email.split('@')[0] || user.email;
                        const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                        await setDoc(userProfileRef, { displayName: defaultDisplayName, timeZone: detectedTimeZone });
                        setDisplayName(defaultDisplayName);
                        setUserTimeZone(detectedTimeZone);
                    }
                } else {
                    // If no user is logged in, attempt to sign in with custom token or anonymously
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        try {
                            await signInWithCustomToken(firebaseAuth, __initial_auth_token);
                        } catch (e) {
                            console.error("Error signing in with custom token:", e);
                            setError("Authentication failed. Please try again.");
                            await signInAnonymously(firebaseAuth); // Fallback to anonymous sign-in
                        }
                    } else {
                        await signInAnonymously(firebaseAuth); // Sign in anonymously if no token
                    }
                    setDisplayName(''); // Clear display name on sign out
                    setUserTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); // Reset to default browser time zone
                }
                setLoading(false); // Authentication process is complete, stop loading
            });

            // Clean up the listener when the component unmounts
            return () => unsubscribe();
        } catch (e) {
            console.error("Failed to initialize Firebase:", e);
            setError("Failed to initialize application. Please refresh.");
            setLoading(false);
        }
    }, [isShareView]); // Dependency on isShareView to re-run init logic

    // useEffect hook to fetch activity items once Firebase and user are ready
    useEffect(() => {
        // Only fetch if not in share view and db/userId are available
        if (!isShareView && db && userId) {
            // Construct the Firestore collection reference for user-specific activity items
            const activitiesColRef = collection(db, `artifacts/${__app_id}/users/${userId}/activityItems`);
            const q = query(activitiesColRef); // Create a query to get all documents in the collection

            // Set up a real-time listener for activity items
            const unsubscribe = onSnapshot(q, (snapshot) => {
                // Map snapshot documents to an array of activity item objects
                const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setActivityItems(items); // Update the activity items state
                // Set default selected activity if there are items and none is selected
                if (items.length > 0 && !newScheduleActivityId) {
                    setNewScheduleActivityId(items[0].id);
                }
            }, (err) => {
                console.error("Error fetching activity items:", err);
                setError("Failed to load activity items."); // Display error if fetching fails
            });

            // Clean up the listener when the component unmounts or dependencies change
            return () => unsubscribe();
        }
    }, [db, userId, newScheduleActivityId, isShareView]); // Dependencies: re-run when db or userId changes

    // useEffect hook to fetch all schedule entries for the current month for calendar dots and selected date view
    useEffect(() => {
        if (!isShareView && db && userId && currentMonth) {
            const scheduleColRef = collection(db, `artifacts/${__app_id}/users/${userId}/schedules`);
            const q = query(scheduleColRef);

            const unsubscribe = onSnapshot(q, (snapshot) => {
                const allEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                const currentMonthStartDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
                const currentMonthEndDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);

                const datesWithActivities = new Map(); // Changed to Map to store color
                const entriesForSelectedDate = [];
                const selectedDateString = selectedDate.toISOString().split('T')[0];
                const selectedDayOfWeek = selectedDate.getDay();

                allEntries.forEach(entry => {
                    const entryStartDate = entry.recurrenceStartDate ? new Date(entry.recurrenceStartDate) : null;
                    const entryEndDate = entry.recurrenceEndDate ? new Date(entry.recurrenceEndDate) : null;

                    // Helper to check if a given date falls within a recurrence range
                    const isDateWithinRecurrenceRange = (dateToCheck) => {
                        const dateOnly = new Date(dateToCheck.getFullYear(), dateToCheck.getMonth(), dateToCheck.getDate());
                        return (!entryStartDate || dateOnly >= entryStartDate) &&
                               (!entryEndDate || dateOnly <= entryEndDate);
                    };

                    // Check if the entry is relevant for the current month's calendar display
                    const isRelevantForMonth = (entry.recurrenceType === 'none' &&
                                                new Date(entry.date).getMonth() === currentMonth.getMonth() &&
                                                new Date(entry.date).getFullYear() === currentMonth.getFullYear()) ||
                                               (entry.recurrenceType !== 'none' &&
                                                isDateWithinRecurrenceRange(currentMonthStartDate) ||
                                                isDateWithinRecurrenceRange(currentMonthEndDate) ||
                                                (currentMonthStartDate >= entryStartDate && currentMonthEndDate <= entryEndDate)
                                               );

                    if (isRelevantForMonth) {
                        // Populate monthlyScheduleData for dots
                        if (entry.recurrenceType === 'none') {
                            if (new Date(entry.date).getMonth() === currentMonth.getMonth() && new Date(entry.date).getFullYear() === currentMonth.getFullYear()) {
                                datesWithActivities.set(entry.date, entry.activityColor); // Store color
                            }
                        } else {
                            // For recurring events, iterate through days of the current month
                            let tempDate = new Date(currentMonthStartDate);
                            while (tempDate <= currentMonthEndDate) {
                                const tempDateString = tempDate.toISOString().split('T')[0];
                                const tempDayOfWeek = tempDate.getDay();

                                if (isDateWithinRecurrenceRange(tempDate) &&
                                    (entry.recurrenceType === 'daily' ||
                                     (entry.recurrenceType === 'weekly' && entry.recurrenceDays.includes(tempDayOfWeek)))) {
                                    // If multiple activities on a day, the last one's color will be used.
                                    // For more robust handling, could store an array of colors or pick a primary.
                                    datesWithActivities.set(tempDateString, entry.activityColor);
                                }
                                tempDate.setDate(tempDate.getDate() + 1);
                            }
                        }
                    }

                    // Filter for entries specific to the selected date
                    const isWithinRecurrenceRangeForSelectedDate = isDateWithinRecurrenceRange(selectedDate);

                    if (isWithinRecurrenceRangeForSelectedDate) {
                        const isOneTime = entry.recurrenceType === 'none' && entry.date === selectedDateString;
                        const isDailyRecurring = entry.recurrenceType === 'daily';
                        const isWeeklyRecurring = entry.recurrenceType === 'weekly' &&
                                                  entry.recurrenceDays &&
                                                  entry.recurrenceDays.includes(selectedDayOfWeek);

                        if (isOneTime || isDailyRecurring || isWeeklyRecurring) {
                            entriesForSelectedDate.push(entry);
                        }
                    }
                });

                setMonthlyScheduleData(datesWithActivities);
                setScheduleEntries(entriesForSelectedDate.sort((a, b) => {
                    const timeA = new Date(a.startDateTimeUTC);
                    const timeB = new Date(b.startDateTimeUTC);
                    return timeA - timeB;
                }));
            }, (err) => {
                console.error("Error fetching schedule entries:", err);
                setError("Failed to load schedule entries.");
            });

            return () => unsubscribe();
        }
    }, [db, userId, selectedDate, currentMonth, isShareView]); // Re-fetch when db, userId, selectedDate, or currentMonth changes

    // Handler for user authentication (login/signup)
    const handleAuth = async (e) => {
        e.preventDefault(); // Prevent default form submission
        setLoading(true); // Start loading state
        setError(null); // Clear previous errors
        try {
            if (isLogin) {
                // Attempt to sign in with provided email and password
                await signInWithEmailAndPassword(auth, email, password);
            } else {
                // Attempt to create a new user with email and password
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCredential.user;
                if (user) {
                    // After successful signup, immediately create a user profile
                    const userProfileRef = doc(db, `artifacts/${__app_id}/users/${user.uid}/profile/userProfile`);
                    const defaultDisplayName = email.split('@')[0] || email;
                    const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                    await setDoc(userProfileRef, { displayName: defaultDisplayName, timeZone: detectedTimeZone });
                    setDisplayName(defaultDisplayName);
                    setUserTimeZone(detectedTimeZone);
                }
            }
        } catch (e) {
            console.error("Auth error:", e);
            setError(e.message); // Display authentication error message
        } finally {
            setLoading(false); // Stop loading state
        }
    };

    // Handler for user sign out
    const handleSignOut = async () => {
        setLoading(true); // Start loading state
        setError(null); // Clear previous errors
        try {
            await signOut(auth); // Sign out the current user
            setUserId(null); // Clear the user ID
            setDisplayName(''); // Clear display name
            setEmail(''); // Clear email input
            setPassword(''); // Clear password input
            setUserTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone); // Reset to default browser time zone
        } catch (e) {
            console.error("Sign out error:", e);
            setError(e.message); // Display sign out error message
        } finally {
            setLoading(false); // Stop loading state
        }
    };

    // Handler to update user's time zone in Firestore
    const handleTimeZoneChange = async (e) => {
        const newTimeZone = e.target.value;
        setUserTimeZone(newTimeZone);
        if (db && userId) {
            try {
                const userProfileRef = doc(db, `artifacts/${__app_id}/users/${userId}/profile/userProfile`);
                await updateDoc(userProfileRef, { timeZone: newTimeZone });
            } catch (e) {
                console.error("Error updating time zone:", e);
                setError("Failed to update time zone.");
            }
        }
    };

    // Handler to add a new activity item
    const handleAddActivity = async () => {
        // Validate input fields
        if (!newActivityName.trim() || !newActivityColor) {
            setError("Activity name and color cannot be empty.");
            return;
        }
        // Ensure db and userId are available
        if (db && userId) {
            try {
                // Add a new document to the activityItems collection
                await addDoc(collection(db, `artifacts/${__app_id}/users/${userId}/activityItems`), {
                    name: newActivityName,
                    color: newActivityColor,
                    userId: userId, // Store userId for ownership
                    createdAt: new Date().toISOString() // Timestamp for creation
                });
                // Clear input fields after successful addition
                setNewActivityName('');
                setNewActivityColor('#000000');
            } catch (e) {
                console.error("Error adding activity:", e);
                setError("Failed to add activity."); // Display error message
            }
        }
    };

    // Handler to delete an activity item
    const handleDeleteActivity = async (id) => {
        // Ensure db and userId are available
        if (db && userId) {
            try {
                // Delete the document from the activityItems collection using its ID
                await deleteDoc(doc(db, `artifacts/${__app_id}/users/${userId}/activityItems`, id));
            } catch (e) {
                console.error("Error deleting activity:", e);
                setError("Failed to delete activity.");
            }
        }
    };

    // Calendar functions
    const getDaysInMonth = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        return new Date(year, month + 1, 0).getDate();
    };

    const getFirstDayOfMonth = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        return new Date(year, month, 1).getDay(); // 0 for Sunday, 1 for Monday, etc.
    };

    const renderCalendarDays = () => {
        const daysInMonth = getDaysInMonth(currentMonth);
        const firstDay = getFirstDayOfMonth(currentMonth);
        const days = [];

        // Add empty cells for days before the 1st of the month
        for (let i = 0; i < firstDay; i++) {
            days.push(<div key={`empty-${i}`} className="p-2 text-center text-gray-400"></div>);
        }

        // Add days of the month
        for (let i = 1; i <= daysInMonth; i++) {
            const dayDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
            const isSelected = selectedDate && dayDate.toDateString() === selectedDate.toDateString();
            const isToday = dayDate.toDateString() === new Date().toDateString();
            const dayDateString = dayDate.toISOString().split('T')[0];
            const activityDotColor = monthlyScheduleData.get(dayDateString); // Get color from Map

            days.push(
                <div
                    key={i}
                    className={`relative p-2 text-center cursor-pointer rounded-md transition duration-200
                                ${isSelected ? 'bg-blue-500 text-white shadow-md' : 'hover:bg-gray-200'}
                                ${isToday && !isSelected ? 'border-2 border-blue-400' : ''}`}
                    onClick={() => setSelectedDate(dayDate)}
                >
                    {i}
                    {activityDotColor && ( // Show dot only if color is present
                        <span
                            className={`absolute bottom-1 right-1 w-2 h-2 rounded-full`}
                            style={{ backgroundColor: activityDotColor }} // Use activity color
                        ></span>
                    )}
                </div>
            );
        }
        return days;
    };

    const changeMonth = (offset) => {
        setCurrentMonth(prevMonth => {
            const newMonth = new Date(prevMonth.getFullYear(), prevMonth.getMonth() + offset, 1);
            // When changing month, reset selected date to the 1st of the new month
            setSelectedDate(new Date(newMonth.getFullYear(), newMonth.getMonth(), 1));
            return newMonth;
        });
    };

    // Handler for recurrence day selection
    const handleRecurrenceDayChange = (dayIndex) => {
        setNewScheduleRecurrenceDays(prevDays =>
            prevDays.includes(dayIndex)
                ? prevDays.filter(d => d !== dayIndex)
                : [...prevDays, dayIndex].sort((a, b) => a - b)
        );
    };

    // Handler to add a new schedule entry
    const handleAddScheduleEntry = async () => {
        if (!selectedDate || !newScheduleActivityId || !newScheduleStartTime || !newScheduleEndTime) {
            setError("Please select a date, activity, start time, and end time.");
            return;
        }

        // Combine selectedDate with newScheduleStartTime/EndTime to create full Date objects in user's local time
        const startDateTimeLocal = new Date(`${selectedDate.toISOString().split('T')[0]}T${newScheduleStartTime}:00`);
        const endDateTimeLocal = new Date(`${selectedDate.toISOString().split('T')[0]}T${newScheduleEndTime}:00`);

        if (startDateTimeLocal >= endDateTimeLocal) {
            setError("End time must be after start time.");
            return;
        }

        if (newScheduleRecurrenceType !== 'none') {
            if (!newScheduleRecurrenceStartDate) {
                setError("Please provide a start date for the repeating schedule.");
                return;
            }
            if (newScheduleRecurrenceEndDate && new Date(newScheduleRecurrenceStartDate) > new Date(newScheduleRecurrenceEndDate)) {
                setError("Recurrence end date cannot be before start date.");
                return;
            }
            if (newScheduleRecurrenceType === 'weekly' && newScheduleRecurrenceDays.length === 0) {
                setError("Please select at least one day for weekly recurrence.");
                return;
            }
        }


        const selectedActivity = activityItems.find(item => item.id === newScheduleActivityId);
        if (!selectedActivity) {
            setError("Selected activity not found.");
            return;
        }

        if (db && userId) {
            try {
                await addDoc(collection(db, `artifacts/${__app_id}/users/${userId}/schedules`), {
                    date: selectedDate.toISOString().split('T')[0], // Store as YYYY-MM-DD for one-time events
                    startDateTimeUTC: startDateTimeLocal.toISOString(), // Store UTC ISO string
                    endDateTimeUTC: endDateTimeLocal.toISOString(),   // Store UTC ISO string
                    activityId: newScheduleActivityId,
                    activityName: selectedActivity.name,
                    activityColor: selectedActivity.color,
                    userId: userId,
                    recurrenceType: newScheduleRecurrenceType,
                    recurrenceDays: newScheduleRecurrenceType === 'weekly' ? newScheduleRecurrenceDays : [], // Store only for weekly
                    recurrenceStartDate: newScheduleRecurrenceType !== 'none' ? newScheduleRecurrenceStartDate : null,
                    recurrenceEndDate: newScheduleRecurrenceType !== 'none' && newScheduleRecurrenceEndDate ? newScheduleRecurrenceEndDate : null,
                    createdAt: new Date().toISOString()
                });
                // Clear form fields
                setNewScheduleStartTime('09:00');
                setNewScheduleEndTime('10:00');
                setNewScheduleActivityId(activityItems.length > 0 ? activityItems[0].id : '');
                setNewScheduleRecurrenceType('none'); // Reset recurrence
                setNewScheduleRecurrenceDays([]); // Reset recurrence days
                setNewScheduleRecurrenceStartDate(new Date().toISOString().split('T')[0]); // Reset to current date
                setNewScheduleRecurrenceEndDate(''); // Clear end date
            } catch (e) {
                console.error("Error adding schedule entry:", e);
                setError("Failed to add schedule entry.");
            }
        }
    };

    // Handler to delete a schedule entry
    const handleDeleteScheduleEntry = async (id) => {
        if (db && userId) {
            try {
                await deleteDoc(doc(db, `artifacts/${__app_id}/users/${userId}/schedules`, id));
            } catch (e) {
                console.error("Error deleting schedule entry:", e);
                setError("Failed to delete schedule entry.");
            }
        }
    };

    // Function to generate and display the share link
    const generateShareLink = () => {
        if (userId) {
            // Construct the share link using the current origin and parameters
            const link = `${window.location.origin}/share?userId=${userId}&date=${selectedDate.toISOString().split('T')[0]}`;
            setShareLink(link);
            setShowShareModal(true);
        } else {
            setError("Please log in to generate a share link.");
        }
    };

    // Display a loading screen while the app initializes
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-xl font-semibold text-gray-700">Loading application...</div>
            </div>
        );
    }

    // Conditional rendering based on URL path
    if (isShareView) {
        return <ShareView db={db} appId={typeof __app_id !== 'undefined' ? __app_id : 'default-app-id'} />;
    }

    return (
        // Provide Firebase instances and user info to all child components via context
        <AppContext.Provider value={{ db, auth, userId, firebaseApp, error, setError }}>
            <div className="min-h-screen bg-gray-100 font-sans text-gray-800">
                {/* Error message display */}
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4" role="alert">
                        <strong className="font-bold">Error:</strong>
                        <span className="block sm:inline"> {error}</span>
                        {/* Close button for the error message */}
                        <span className="absolute top-0 bottom-0 right-0 px-4 py-3" onClick={() => setError(null)}>
                            <svg className="fill-current h-6 w-6 text-red-500" role="button" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><title>Close</title><path d="M14.348 14.849a1.2 1.2 0 0 1-1.697 0L10 11.103l-2.651 3.746a1.2 1.2 0 = 0 1-1.697-1.697l3.746-2.651-3.746-2.651a1.2 1.2 0 0 1 1.697-1.697L10 8.897l2.651-3.746a1.2 1.2 0 0 1 1.697 1.697L11.103 10l3.746 2.651a1.2 1.2 0 0 1 0 1.698z"/></svg>
                        </span>
                    </div>
                )}

                {/* Conditional rendering based on user authentication status */}
                {!userId ? (
                    // Authentication form (Login/Sign Up)
                    <div className="flex items-center justify-center min-h-screen">
                        <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
                            <h2 className="text-2xl font-bold mb-6 text-center text-gray-700">{isLogin ? 'Login' : 'Sign Up'}</h2>
                            <form onSubmit={handleAuth}>
                                <div className="mb-4">
                                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="email">
                                        Email
                                    </label>
                                    <input
                                        className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                        id="email"
                                        type="email"
                                        placeholder="Email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="mb-6">
                                    <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">
                                        Password
                                    </label>
                                    <input
                                        className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 mb-3 leading-tight focus:outline-none focus:shadow-outline"
                                        id="password"
                                        type="password"
                                        placeholder="********"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <button
                                        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-300"
                                        type="submit"
                                    >
                                        {isLogin ? 'Login' : 'Sign Up'}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsLogin(!isLogin)}
                                        className="inline-block align-baseline font-bold text-sm text-blue-500 hover:text-blue-800"
                                    >
                                        {isLogin ? 'Need an account? Sign Up' : 'Already have an account? Login'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                ) : (
                    // Main application content once authenticated
                    <div className="container mx-auto p-4">
                        <header className="flex justify-between items-center bg-white p-4 rounded-lg shadow-md mb-6">
                            <h1 className="text-3xl font-bold text-gray-700">My Availability</h1>
                            <div className="flex items-center space-x-4">
                                {/* Display current user's display name and ID */}
                                <span className="text-gray-600">Welcome, {displayName} ({userId})</span>
                                {/* Time Zone Selector */}
                                <div className="flex items-center space-x-2">
                                    <label htmlFor="timeZoneSelect" className="text-gray-700 text-sm font-bold">Time Zone:</label>
                                    <select
                                        id="timeZoneSelect"
                                        className="shadow border rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                        value={userTimeZone}
                                        onChange={handleTimeZoneChange}
                                    >
                                        {timeZones.map(tz => (
                                            <option key={tz} value={tz}>{tz}</option>
                                        ))}
                                    </select>
                                </div>
                                <button
                                    onClick={generateShareLink}
                                    className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-300"
                                >
                                    Share Schedule
                                </button>
                                <button
                                    onClick={handleSignOut}
                                    className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-300"
                                >
                                    Sign Out
                                </button>
                            </div>
                        </header>

                        <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Activity Items Management Section */}
                            <section className="lg:col-span-1 bg-white p-6 rounded-lg shadow-md h-fit">
                                <h2 className="text-2xl font-semibold mb-4 text-gray-700">Manage Activities</h2>
                                <div className="mb-4">
                                    <label htmlFor="activityName" className="block text-gray-700 text-sm font-bold mb-2">Activity Name</label>
                                    <input
                                        type="text"
                                        id="activityName"
                                        className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline mb-2"
                                        value={newActivityName}
                                        onChange={(e) => setNewActivityName(e.target.value)}
                                        placeholder="e.g., Work, Gym, Free"
                                    />
                                    <label htmlFor="activityColor" className="block text-gray-700 text-sm font-bold mb-2">Color</label>
                                    <input
                                        type="color"
                                        id="activityColor"
                                        className="w-full h-10 rounded-md border-gray-300 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
                                        value={newActivityColor}
                                        onChange={(e) => setNewActivityColor(e.target.value)}
                                    />
                                    <button
                                        onClick={handleAddActivity}
                                        className="mt-4 bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-300 w-full"
                                    >
                                        Add Activity
                                    </button>
                                </div>

                                <h3 className="text-xl font-medium mb-3 text-gray-700">Your Activities</h3>
                                {activityItems.length === 0 ? (
                                    <p className="text-gray-500">No activities defined yet.</p>
                                ) : (
                                    <ul className="space-y-2">
                                        {activityItems.map(item => (
                                            <li key={item.id} className="flex items-center justify-between bg-gray-50 p-3 rounded-md shadow-sm">
                                                <div className="flex items-center">
                                                    {/* Color swatch for the activity */}
                                                    <span className="block w-4 h-4 rounded-full mr-3" style={{ backgroundColor: item.color }}></span>
                                                    <span className="text-gray-700 font-medium">{item.name}</span>
                                                </div>
                                                <button
                                                    onClick={() => handleDeleteActivity(item.id)}
                                                    className="bg-red-400 hover:bg-red-600 text-white text-xs font-bold py-1 px-2 rounded transition duration-300"
                                                >
                                                    Delete
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>

                            {/* Schedule Calendar Section */}
                            <section className="lg:col-span-2 bg-white p-6 rounded-lg shadow-md">
                                <h2 className="text-2xl font-semibold mb-4 text-gray-700">Your Schedule</h2>

                                {/* Calendar Navigation */}
                                <div className="flex justify-between items-center mb-4">
                                    <button
                                        onClick={() => changeMonth(-1)}
                                        className="bg-blue-200 hover:bg-blue-300 text-blue-800 font-bold py-2 px-4 rounded transition duration-300"
                                    >
                                        &lt; Prev
                                    </button>
                                    <h3 className="text-xl font-semibold">
                                        {currentMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: userTimeZone })}
                                    </h3>
                                    <button
                                        onClick={() => changeMonth(1)}
                                        className="bg-blue-200 hover:bg-blue-300 text-blue-800 font-bold py-2 px-4 rounded transition duration-300"
                                    >
                                        Next &gt;
                                    </button>
                                </div>

                                {/* Calendar Grid */}
                                <div className="grid grid-cols-7 gap-1 text-center font-medium mb-4">
                                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                                        <div key={day} className="p-2 text-gray-600">{day}</div>
                                    ))}
                                    {renderCalendarDays()}
                                </div>

                                {/* Selected Date Schedule */}
                                <h3 className="text-xl font-semibold mb-3 text-gray-700">Schedule for {formatDate(selectedDate, userTimeZone)}</h3>

                                {/* Add New Schedule Entry Form */}
                                <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
                                    <h4 className="text-lg font-medium mb-3 text-gray-700">Add New Entry</h4>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                                        <div>
                                            <label htmlFor="startTime" className="block text-gray-700 text-sm font-bold mb-1">Start Time (Your Time Zone)</label>
                                            <input
                                                type="time"
                                                id="startTime"
                                                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                                value={newScheduleStartTime}
                                                onChange={(e) => setNewScheduleStartTime(e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="endTime" className="block text-gray-700 text-sm font-bold mb-1">End Time (Your Time Zone)</label>
                                            <input
                                                type="time"
                                                id="endTime"
                                                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                                value={newScheduleEndTime}
                                                onChange={(e) => setNewScheduleEndTime(e.target.value)}
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="activitySelect" className="block text-gray-700 text-sm font-bold mb-1">Activity</label>
                                            <select
                                                id="activitySelect"
                                                className="shadow border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline h-10"
                                                value={newScheduleActivityId}
                                                onChange={(e) => setNewScheduleActivityId(e.target.value)}
                                            >
                                                {activityItems.length === 0 ? (
                                                    <option value="">No activities defined</option>
                                                ) : (
                                                    activityItems.map(item => (
                                                        <option key={item.id} value={item.id}>{item.name}</option>
                                                    ))
                                                )}
                                            </select>
                                        </div>
                                    </div>

                                    {/* Recurrence Type Selection */}
                                    <div className="mb-4">
                                        <label htmlFor="recurrenceType" className="block text-gray-700 text-sm font-bold mb-1">Repeats</label>
                                        <select
                                            id="recurrenceType"
                                            className="shadow border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline h-10"
                                            value={newScheduleRecurrenceType}
                                            onChange={(e) => {
                                                setNewScheduleRecurrenceType(e.target.value);
                                                // Reset recurrence days if type changes from weekly
                                                if (e.target.value !== 'weekly') {
                                                    setNewScheduleRecurrenceDays([]);
                                                }
                                            }}
                                        >
                                            <option value="none">Does not repeat</option>
                                            <option value="daily">Daily</option>
                                            <option value="weekly">Weekly</option>
                                        </select>
                                    </div>

                                    {/* Recurrence Date Range (Conditional) */}
                                    {newScheduleRecurrenceType !== 'none' && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                            <div>
                                                <label htmlFor="recurrenceStartDate" className="block text-gray-700 text-sm font-bold mb-1">Start Date</label>
                                                <input
                                                    type="date"
                                                    id="recurrenceStartDate"
                                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                                    value={newScheduleRecurrenceStartDate}
                                                    onChange={(e) => setNewScheduleRecurrenceStartDate(e.target.value)}
                                                    required
                                                />
                                            </div>
                                            <div>
                                                <label htmlFor="recurrenceEndDate" className="block text-gray-700 text-sm font-bold mb-1">End Date (Optional)</label>
                                                <input
                                                    type="date"
                                                    id="recurrenceEndDate"
                                                    className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                                                    value={newScheduleRecurrenceEndDate}
                                                    onChange={(e) => setNewScheduleRecurrenceEndDate(e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Weekly Recurrence Days Selection (Conditional) */}
                                    {newScheduleRecurrenceType === 'weekly' && (
                                        <div className="mb-4">
                                            <label className="block text-gray-700 text-sm font-bold mb-1">Repeat on</label>
                                            <div className="flex flex-wrap gap-2">
                                                {weekdays.map((day, index) => (
                                                    <label key={index} className="inline-flex items-center">
                                                        <input
                                                            type="checkbox"
                                                            className="form-checkbox h-5 w-5 text-blue-600 rounded"
                                                            value={index}
                                                            checked={newScheduleRecurrenceDays.includes(index)}
                                                            onChange={() => handleRecurrenceDayChange(index)}
                                                        />
                                                        <span className="ml-2 text-gray-700">{day.substring(0, 3)}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        onClick={handleAddScheduleEntry}
                                        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline transition duration-300 w-full"
                                        disabled={activityItems.length === 0}
                                    >
                                        Add Schedule Entry
                                    </button>
                                </div>

                                {/* Display Schedule Entries */}
                                {scheduleEntries.length === 0 ? (
                                    <p className="text-gray-500">No schedule entries for this date.</p>
                                ) : (
                                    <ul className="space-y-3">
                                        {scheduleEntries.map(entry => (
                                            <li key={entry.id} className="flex items-center justify-between bg-white p-3 rounded-md shadow-sm border-l-4" style={{ borderColor: entry.activityColor }}>
                                                <div>
                                                    <span className="font-semibold text-gray-800">{entry.activityName}</span>
                                                    <p className="text-sm text-gray-600">
                                                        {formatTime(entry.startDateTimeUTC, userTimeZone)} - {formatTime(entry.endDateTimeUTC, userTimeZone)}
                                                        {entry.recurrenceType !== 'none' && (
                                                            <span className="ml-2 text-xs text-gray-500">
                                                                ({entry.recurrenceType === 'daily' ? 'Daily' :
                                                                  entry.recurrenceType === 'weekly' ? `Weekly on ${entry.recurrenceDays.map(d => weekdays[d].substring(0, 3)).join(', ')}` : ''})
                                                                {entry.recurrenceStartDate && ` from ${entry.recurrenceStartDate}`}
                                                                {entry.recurrenceEndDate && ` to ${entry.recurrenceEndDate}`}
                                                            </span>
                                                        )}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => handleDeleteScheduleEntry(entry.id)}
                                                    className="bg-red-400 hover:bg-red-600 text-white text-xs font-bold py-1 px-2 rounded transition duration-300"
                                                >
                                                    Delete
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </section>
                        </main>
                    </div>
                )}

                {/* Share Link Modal */}
                {showShareModal && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
                        <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
                            <h3 className="text-xl font-bold mb-4 text-gray-800">Share Your Schedule</h3>
                            <p className="mb-4 text-gray-700">Copy this link to share your schedule:</p>
                            <div className="flex items-center border border-gray-300 rounded-md p-3 bg-gray-50 mb-4">
                                <input
                                    type="text"
                                    readOnly
                                    value={shareLink}
                                    className="flex-grow bg-transparent outline-none text-gray-700"
                                />
                                <button
                                    onClick={() => {
                                        // Use document.execCommand('copy') for better compatibility in iframes
                                        const el = document.createElement('textarea');
                                        el.value = shareLink;
                                        document.body.appendChild(el);
                                        el.select();
                                        document.execCommand('copy');
                                        document.body.removeChild(el);
                                        // Replaced alert with a simple message for better UX
                                        setError("Link copied to clipboard!");
                                        setTimeout(() => setError(null), 3000); // Clear message after 3 seconds
                                    }}
                                    className="ml-3 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded transition duration-300"
                                >
                                    Copy
                                </button>
                            </div>
                            <button
                                onClick={() => setShowShareModal(false)}
                                className="bg-gray-300 hover:bg-gray-400 text-gray-800 font-bold py-2 px-4 rounded transition duration-300 w-full"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </AppContext.Provider>
    );
};

export default App;
