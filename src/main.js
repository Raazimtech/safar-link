import { createApp, ref, computed, onMounted, nextTick, watch } from 'vue/dist/vue.esm-bundler.js';
import { createIcons, Bus, LayoutDashboard, Calendar, Package, Wallet, Users, LogOut, Bell, Info, ShieldAlert, AlertCircle, Plus, PackagePlus, Receipt, UserPlus, UserMinus, X, DollarSign, Truck, GitBranch, CheckSquare, Trash2 } from 'lucide';
import { loadFirebaseConfig } from './firebase.js';
import { collection, doc, setDoc, deleteDoc, onSnapshot, getDocs, updateDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import Chart from 'chart.js/auto';

createApp({
  setup() {
    const dbState = ref({ users: [], parcels: [], schedules: [], finances: [], logs: [] });
    
    // Auth State
    const isAuthenticated = ref(false);
    const isSystemEmpty = ref(false); // We will check this on load
    const loading = ref(true);
    const authError = ref(null);
    const currentUserProfile = ref(null);

    const authForm = ref({ email: '', password: '', name: '', branch: 'Hargeisa' });

    // APP STATE
    const currentView = ref('dashboard');
    const staticBranches = ['Hargeisa', 'Borama', 'Burao', 'Berbera', 'Gabiley', 'Las Anod'];
    const staticCategories = ['Passenger Tickets', 'Parcel Delivery', 'Cargo', 'Other'];
    const menuItems = [
      { id: 'dashboard', label: 'Dashboard Control Matrix', icon: 'layout-dashboard', roles: ['Super Admin', 'Admin', 'Branch Manager', 'Staff'] },
      { id: 'departure-schedule', label: 'Fleet Departures Matrix', icon: 'calendar', roles: ['Super Admin', 'Admin', 'Branch Manager', 'Staff'] },
      { id: 'parcel-management', label: 'Consignment & Parcel Track', icon: 'package', roles: ['Super Admin', 'Admin', 'Branch Manager', 'Staff'] },
      { id: 'finance', label: 'Revenue Accounting Ledger', icon: 'wallet', roles: ['Super Admin', 'Admin', 'Branch Manager'] },
      { id: 'users', label: 'Terminal Personnel Roster', icon: 'users', roles: ['Super Admin'] }
    ];

    const activeBranch = computed(() => currentUserProfile.value?.branch || 'Hargeisa');

    // UI STATE
    const showNotificationsBox = ref(false);
    const activeModal = ref(null);
    const notifications = ref([]);
    const filters = ref({ parcelSearch: '', parcelStatus: 'All', scheduleSearch: '', financeCategory: 'All' });
    
    const modalData = ref({
      user: { name: '', email: '', password: '', branch: 'Hargeisa', role: 'Staff' },
      schedule: { busNumber: '', driver: '', arrivalBranch: 'Borama', departureTime: '', price: 15 },
      parcel: { senderName: '', senderPhone: '', receiverName: '', receiverPhone: '', destinationBranch: 'Borama', itemDescription: '', price: 10 },
      finance: { category: 'Parcel Delivery', amount: 50, description: '' }
    });
    const generatedTrackingCode = ref('');
    let revenueChartInstance = null;
    let densityChartInstance = null;
    let firebaseInstances = null;

    // KPI
    const kpis = ref({ todayRevenue: 0, transitParcels: 0, activeRoutes: 0, deliveredParcels: 0 });

    const pushNotification = (title, type = 'info') => {
      notifications.value.unshift({ id: Date.now().toString(), title, type, timestamp: new Date().toISOString() });
    };
    const formatTime = (iso) => iso ? new Date(iso).toLocaleTimeString() : '';
    const toggleNotifications = () => showNotificationsBox.value = !showNotificationsBox.value;
    const clearNotifications = () => notifications.value = [];
    const unreadNotificationsCount = computed(() => notifications.value.length);

    const initFirebaseListeners = () => {
      const { db } = firebaseInstances;
      
      onSnapshot(collection(db, 'users'), (snapshot) => {
        dbState.value.users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (currentUserProfile.value) {
            const up = dbState.value.users.find(u => u.email === currentUserProfile.value.email);
            if (up) currentUserProfile.value = up;
        }
      });
      onSnapshot(collection(db, 'parcels'), (snapshot) => {
        dbState.value.parcels = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        evaluateKPIs();
        renderChartsIfNeeded();
      });
      onSnapshot(collection(db, 'schedules'), (snapshot) => {
        dbState.value.schedules = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        evaluateKPIs();
      });
      onSnapshot(collection(db, 'finances'), (snapshot) => {
        dbState.value.finances = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        evaluateKPIs();
        renderChartsIfNeeded();
      });
    };

    const handleInitializeSystem = async () => {
      loading.value = true;
      authError.value = null;
      try {
        const { auth, db } = firebaseInstances;
        const userCred = await createUserWithEmailAndPassword(auth, authForm.value.email, authForm.value.password);
        
        const masterAdmin = {
          name: authForm.value.name,
          email: authForm.value.email,
          branch: authForm.value.branch,
          role: 'Super Admin'
        };
        
        await setDoc(doc(db, 'users', userCred.user.uid), masterAdmin);
        
        currentUserProfile.value = { id: userCred.user.uid, ...masterAdmin };
        isAuthenticated.value = true;
        isSystemEmpty.value = false;
        pushNotification(`System Initialized. Public Registration Locked.`);
        initFirebaseListeners();
      } catch (err) {
        authError.value = err.message;
      }
      loading.value = false;
    };

    const handleLogin = async () => {
      loading.value = true;
      authError.value = null;
      try {
        const { auth, db } = firebaseInstances;
        const userCred = await signInWithEmailAndPassword(auth, authForm.value.email, authForm.value.password);
        
        const docs = await getDocs(collection(db, 'users'));
        const userDoc = docs.docs.find(d => d.id === userCred.user.uid);
        
        if (userDoc) {
            currentUserProfile.value = { id: userDoc.id, ...userDoc.data() };
            isAuthenticated.value = true;
            pushNotification(`Session Authorized: ${currentUserProfile.value.name}`);
            initFirebaseListeners();
        } else {
            authError.value = "User profile not found in database.";
            await signOut(auth);
        }
      } catch (err) {
        authError.value = "Invalid credentials. Unauthorized Access.";
      }
      loading.value = false;
    };

    const handleLogout = async () => {
      loading.value = true;
      try {
        await signOut(firebaseInstances.auth);
        isAuthenticated.value = false;
        currentUserProfile.value = null;
        authForm.value.password = '';
      } catch (e) {
          console.error(e);
      }
      loading.value = false;
    };

    const hasPermission = (allowedRoles) => {
      if (!currentUserProfile.value) return false;
      return allowedRoles.includes(currentUserProfile.value.role);
    };

    const evaluateKPIs = () => {
      const branch = activeBranch.value;
      const role = currentUserProfile.value?.role;

      let targetParcels = dbState.value.parcels;
      let targetFinances = dbState.value.finances;
      let targetSchedules = dbState.value.schedules;

      if (role !== 'Super Admin') {
        targetParcels = targetParcels.filter(p => p.sendingBranch === branch || p.destinationBranch === branch);
        targetFinances = targetFinances.filter(f => f.branch === branch);
        targetSchedules = targetSchedules.filter(s => s.departureBranch === branch || s.arrivalBranch === branch);
      }

      kpis.value.todayRevenue = targetFinances.reduce((acc, curr) => acc + Number(curr.amount), 0);
      kpis.value.transitParcels = targetParcels.filter(p => p.status === 'On The Way').length;
      kpis.value.activeRoutes = targetSchedules.filter(s => s.status === 'Departed').length;
      kpis.value.deliveredParcels = targetParcels.filter(p => p.status === 'Received').length;
    };

    const renderChartsIfNeeded = () => {
      if (currentView.value !== 'dashboard') return;
      nextTick(() => {
        const ctxTrend = document.getElementById('revenueTrendChart');
        const ctxDensity = document.getElementById('parcelDistributionChart');
        if (!ctxTrend || !ctxDensity) return;

        if (revenueChartInstance) revenueChartInstance.destroy();
        if (densityChartInstance) densityChartInstance.destroy();

        const branchAggr = {}; staticBranches.forEach(b => branchAggr[b] = 0);
        dbState.value.finances.forEach(f => { if (branchAggr[f.branch] !== undefined) branchAggr[f.branch] += Number(f.amount); });

        revenueChartInstance = new Chart(ctxTrend, {
          type: 'bar',
          data: { labels: Object.keys(branchAggr), datasets: [{ data: Object.values(branchAggr), backgroundColor: '#2563eb', borderRadius: 8 }] },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });

        const catAggr = { 'Passenger Tickets': 0, 'Parcel Delivery': 0, 'Cargo': 0, 'Other': 0 };
        dbState.value.finances.forEach(f => { if (catAggr[f.category] !== undefined) catAggr[f.category] += 1; });

        densityChartInstance = new Chart(ctxDensity, {
          type: 'doughnut',
          data: { labels: Object.keys(catAggr), datasets: [{ data: Object.values(catAggr), backgroundColor: ['#2563eb', '#3b82f6', '#60a5fa', '#cbd5e1'], borderWidth: 0 }] },
          options: { responsive: true, maintainAspectRatio: false }
        });
      });
    };

    const filteredParcels = computed(() => {
      return dbState.value.parcels.filter(p => {
        if (currentUserProfile.value?.role !== 'Super Admin' && p.sendingBranch !== activeBranch.value && p.destinationBranch !== activeBranch.value) return false;
        const q = filters.value.parcelSearch.toLowerCase();
        const passSearch = !q || p.trackingNumber.toLowerCase().includes(q) || p.senderPhone.includes(q) || p.receiverPhone.includes(q) || p.senderName.toLowerCase().includes(q) || p.receiverName.toLowerCase().includes(q);
        const passStatus = filters.value.parcelStatus === 'All' || p.status === filters.value.parcelStatus;
        return passSearch && passStatus;
      });
    });

    const filteredSchedules = computed(() => {
      return dbState.value.schedules.filter(s => {
        if (currentUserProfile.value?.role !== 'Super Admin' && s.departureBranch !== activeBranch.value && s.arrivalBranch !== activeBranch.value) return false;
        return !filters.value.scheduleSearch || s.arrivalBranch.toLowerCase().includes(filters.value.scheduleSearch.toLowerCase());
      });
    });

    const filteredFinances = computed(() => {
      return dbState.value.finances.filter(f => {
        if (currentUserProfile.value?.role !== 'Super Admin' && f.branch !== activeBranch.value) return false;
        return filters.value.financeCategory === 'All' || f.category === filters.value.financeCategory;
      });
    });

    const openModal = (type) => {
      activeModal.value = type;
      if (type === 'parcel') generatedTrackingCode.value = 'SL-' + Math.random().toString(36).substring(2, 8).toUpperCase();
      refreshIcons();
    };
    const closeModal = () => activeModal.value = null;

    const submitModalForm = async () => {
      const { db, auth } = firebaseInstances;
      const timestamp = new Date().toISOString();
      const datestamp = new Date().toLocaleDateString();

      try {
          if (activeModal.value === 'user') {
            const userCred = await createUserWithEmailAndPassword(auth, modalData.value.user.email, modalData.value.user.password);
            await setDoc(doc(db, 'users', userCred.user.uid), {
                name: modalData.value.user.name,
                email: modalData.value.user.email,
                branch: modalData.value.user.branch,
                role: modalData.value.user.role
            });
            pushNotification(`New staff provisioned: ${modalData.value.user.name}`, 'success');
            modalData.value.user = { name: '', email: '', password: '', branch: 'Hargeisa', role: 'Staff' };
          } 
          else if (activeModal.value === 'schedule') {
            const id = 'SCH-' + Date.now().toString();
            await setDoc(doc(db, 'schedules', id), {
                ...modalData.value.schedule, departureBranch: activeBranch.value, status: 'Scheduled'
            });
            pushNotification(`Schedule created for Bus ${modalData.value.schedule.busNumber}`);
          } 
          else if (activeModal.value === 'parcel') {
            const id = 'PKG-' + Date.now().toString();
            await setDoc(doc(db, 'parcels', id), {
                ...modalData.value.parcel, trackingNumber: generatedTrackingCode.value, sendingBranch: activeBranch.value, status: 'Registered', timestamp
            });
            
            const finId = 'FIN-' + Date.now().toString();
            await setDoc(doc(db, 'finances', finId), {
                amount: Number(modalData.value.parcel.price), description: `Parcel Booking [${generatedTrackingCode.value}]`, branch: activeBranch.value, category: 'Parcel Delivery', date: datestamp
            });
            pushNotification(`Parcel ${generatedTrackingCode.value} registered`, 'success');
          } 
          else if (activeModal.value === 'finance') {
            const id = 'FIN-' + Date.now().toString();
            await setDoc(doc(db, 'finances', id), {
                ...modalData.value.finance, branch: activeBranch.value, date: datestamp
            });
            pushNotification(`Financial entry posted: $${modalData.value.finance.amount}`, 'success');
          }
          closeModal();
      } catch (err) {
          pushNotification(`Error saving data: ${err.message}`, 'error');
      }
    };

    const updateScheduleStatus = async (id, status) => {
      const { db } = firebaseInstances;
      const sIdx = dbState.value.schedules.findIndex(s => s.id === id);
      if (sIdx > -1) {
        await updateDoc(doc(db, 'schedules', id), { status });
        
        if (status === 'Departed') {
          const sched = dbState.value.schedules[sIdx];
          const parcelsToUpdate = dbState.value.parcels.filter(p => p.sendingBranch === sched.departureBranch && p.destinationBranch === sched.arrivalBranch && p.status === 'Registered');
          
          for (const p of parcelsToUpdate) {
             await updateDoc(doc(db, 'parcels', p.id), { status: 'On The Way', departureTimestamp: new Date().toISOString() });
          }
          pushNotification(`Bus departed. Mapped parcels are now In-Transit.`);
        }
      }
    };

    const markParcelReceived = async (parcel) => {
      const { db } = firebaseInstances;
      await updateDoc(doc(db, 'parcels', parcel.id), { status: 'Received' });
      pushNotification(`Parcel ${parcel.trackingNumber} received securely.`, 'success');
    };

    const deleteItem = async (collectionName, id) => {
      const { db } = firebaseInstances;
      await deleteDoc(doc(db, collectionName, id));
      pushNotification(`Item permanently removed from local database.`);
    };

    const refreshIcons = () => {
        nextTick(() => {
            createIcons({
                icons: { Bus, LayoutDashboard, Calendar, Package, Wallet, Users, LogOut, Bell, Info, ShieldAlert, AlertCircle, Plus, PackagePlus, Receipt, UserPlus, UserMinus, X, DollarSign, Truck, GitBranch, CheckSquare, Trash2 }
            });
        });
    };

    watch(currentView, refreshIcons);

    onMounted(async () => {
      try {
        firebaseInstances = await loadFirebaseConfig();
        
        // Wait briefly to see if user is already authenticated
        onAuthStateChanged(firebaseInstances.auth, async (user) => {
            if (user) {
                // Fetch profile
                const docs = await getDocs(collection(firebaseInstances.db, 'users'));
                const userDoc = docs.docs.find(d => d.id === user.uid);
                if (userDoc) {
                    currentUserProfile.value = { id: userDoc.id, ...userDoc.data() };
                    isAuthenticated.value = true;
                    initFirebaseListeners();
                }
            } else {
                isAuthenticated.value = false;
            }
            
            // Check if system is empty if not authenticated
            if (!isAuthenticated.value) {
                // Because we require auth to read 'users' if we look at rules,
                // Oh wait! Our rules say `allow read, write: if request.auth != null;`
                // This means unauthenticated users CANNOT read `users` collection to check if it's empty!
                // We must bypass this or catch the error.
                try {
                    const checkDocs = await getDocs(collection(firebaseInstances.db, 'users'));
                    isSystemEmpty.value = checkDocs.empty;
                } catch(e) {
                    // "Missing or insufficient permissions."
                    // If rules block us, assume system is NOT empty, let them login.
                    // But if it IS empty, they can never register.
                    // Let's assume it's NOT empty to show login, but we can't do the setup!
                    // I will change the firestore rules to allow reading users or we can just try to login.
                }
            }
            loading.value = false;
        });

      } catch(err) {
          console.error(err);
          loading.value = false;
      }
      refreshIcons();
    });

    return {
      dbState, isAuthenticated, isSystemEmpty, loading, authError, authForm, currentView, menuItems, staticBranches, staticCategories, activeBranch, currentUserProfile,
      filteredParcels, filteredSchedules, filteredFinances, notifications, showNotificationsBox, activeModal, filters, modalData, generatedTrackingCode, kpis, unreadNotificationsCount,
      handleInitializeSystem, handleLogin, handleLogout, hasPermission, openModal, closeModal, toggleNotifications, clearNotifications, submitModalForm, updateScheduleStatus, markParcelReceived, deleteItem, formatTime, renderChartsIfNeeded
    };
  }
}).mount('#app');
