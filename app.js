;(() => {
  'use strict'

  dayjs.locale('es')

  // ======== CONFIGURACIÓN DE API ========
  const ACCESS_KEY = '082fcef099b48cf3494902b9644c349c'
  const BASE = 'http://api.aviationstack.com/v1'
  const PROXY = 'https://api.allorigins.win/raw?url='
  const useProxy = true

  const airportsMX = [
    { code: 'MEX', name: 'CDMX - AICM (MEX)' },
    { code: 'NLU', name: 'CDMX - AIFA (NLU)' },
    { code: 'GDL', name: 'Guadalajara (GDL)' },
    { code: 'MTY', name: 'Monterrey (MTY)' },
    { code: 'CUN', name: 'Cancún (CUN)' },
    { code: 'TIJ', name: 'Tijuana (TIJ)' },
    { code: 'PVR', name: 'Puerto Vallarta (PVR)' },
    { code: 'QRO', name: 'Querétaro (QRO)' },
    { code: 'ZLO', name: 'Manzanillo (ZLO)' },
    { code: 'SJD', name: 'Los Cabos (SJD)' },
    { code: 'TPQ', name: 'Tepic (TPQ)' },
    { code: 'VER', name: 'Veracruz (VER)' },
  ]

  const AIRLINES = [
    'Aeromexico','Aeroméxico','Volaris','VivaAerobus','Aerus','TAR Aerolíneas','TAR',
    'American Airlines','Delta Air Lines','United Airlines','Alaska Airlines','JetBlue','Southwest','Frontier','Spirit Airlines',
    'Air Canada','WestJet','Copa Airlines','Avianca','LATAM Airlines','Iberia','Air Europa','Lufthansa','KLM','Air France',
    'Turkish Airlines','Emirates','British Airways','Condor','Edelweiss Air','Neos','TUI Airways','TUI fly Netherlands','TUI fly Belgium','Sun Country Airlines'
  ]

  const STATUS_MAP = {
    scheduled: { label: 'Programado', badge:'secondary' },
    active:    { label: 'Activo',     badge:'primary' },
    landed:    { label: 'Aterrizado', badge:'success' },
    cancelled: { label: 'Cancelado',  badge:'danger' },
    incident:  { label: 'Incidente',  badge:'warning' },
    diverted:  { label: 'Desviado',   badge:'warning' },
    unknown:   { label: 'Desconocido',badge:'secondary' },
  }

  const $ = (sel, ctx = document) => ctx.querySelector(sel)
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel))
  const byId = (id) => document.getElementById(id)

  const formatTime = (iso) => {
    if (!iso) return '—'
    const d = dayjs(iso)
    return d.isValid() ? d.format('DD MMM, HH:mm') : '—'
  }

  const debounce = (fn, delay=300) => { let t; return (...args) => { clearTimeout(t); t=setTimeout(()=>fn(...args), delay) } }

  function normalizeStr(s){
    return (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
  }

  function timeInRange(iso, from, to){
    if (!iso) return false
    const d = dayjs(iso); if (!d.isValid()) return false
    const hhmm = d.format('HH:mm')
    if (from && hhmm < from) return false
    if (to && hhmm > to) return false
    return true
  }

  function filterRows(rows, { flight='', airline='', origin='', dest='', depFrom='', depTo='', arrFrom='', arrTo='', status='' }){
    const nf = normalizeStr(flight), na = normalizeStr(airline), no = normalizeStr(origin), nd = normalizeStr(dest)
    const st = (status||'').toLowerCase()
    return rows.filter(r => {
      if (nf && !normalizeStr(r.number).includes(nf)) return false
      if (na && !normalizeStr(r.airline).includes(na)) return false
      if (no && !normalizeStr(r.dep_airport).includes(no)) return false
      if (nd && !normalizeStr(r.arr_airport).includes(nd)) return false
      if ((depFrom || depTo) && !timeInRange(r.dep_scheduled, depFrom, depTo)) return false
      if ((arrFrom || arrTo) && !timeInRange(r.arr_scheduled, arrFrom, arrTo)) return false
      if (st && (r.status||'').toLowerCase() !== st) return false
      return true
    })
  }

  // ======== Servicio Aviationstack ========
  const AviationService = (() => {
    const url = (path, params) => {
      const query = new URLSearchParams(params).toString()
      const full = `${BASE}${path}?${query}`
      return useProxy ? `${PROXY}${encodeURIComponent(full)}` : full
    }

    const mapFlight = (it) => ({
      number: it?.flight?.iata || it?.flight?.number || it?.flight?.icao || '—',
      airline: it?.airline?.name || '—',
      dep_airport: `${it?.departure?.airport || '—'} (${it?.departure?.iata || '—'})`,
      arr_airport: `${it?.arrival?.airport || '—'} (${it?.arrival?.iata || '—'})`,
      dep_scheduled: it?.departure?.scheduled || null,
      arr_scheduled: it?.arrival?.scheduled || null,
      status: (it?.flight_status || 'unknown').toLowerCase(),
      raw: it,
    })

    async function fetchMany(paths) {
      const res = await Promise.all(paths.map((p) => axios.get(p).then(r => r.data).catch(() => ({ data: [] }))))
      return res.flatMap(r => r?.data || [])
    }

    return {
      async arrivals(mxAirports = []) {
        if (!ACCESS_KEY) throw new Error('Falta API key')
        const airports = mxAirports.slice(0,5)
        const endpoints = airports.map(a => url('/flights', { access_key: ACCESS_KEY, arr_iata: a, limit: 50 }))
        const data = await fetchMany(endpoints)
        return data.map(mapFlight)
      },
      async departures(mxAirports = []) {
        if (!ACCESS_KEY) throw new Error('Falta API key')
        const airports = mxAirports.slice(0,5)
        const endpoints = airports.map(a => url('/flights', { access_key: ACCESS_KEY, dep_iata: a, limit: 50 }))
        const data = await fetchMany(endpoints)
        return data.map(mapFlight)
      },
      async trackByNumber(flightNumber) {
        if (!ACCESS_KEY) throw new Error('Falta API key')
        const endpoint = url('/flights', { access_key: ACCESS_KEY, flight_iata: flightNumber, limit: 1 })
        const { data } = await axios.get(endpoint).then(r => r.data).catch(() => ({ data: [] }))
        return data.length ? mapFlight(data[0]) : null
      }
    }
  })()

  // ======== UI ========
  const UI = (() => {
    let charts = {}

    function badgeStatus(status){
      const map = STATUS_MAP[status] || STATUS_MAP.unknown
      return `<span class="badge rounded-pill text-bg-${map.badge} badge-status">${map.label}</span>`
    }

    function renderTable(tbody, flights, kind='arrivals'){
      tbody.innerHTML = flights.map(f => `
        <tr>
          <td class="fw-semibold">${f.number}</td>
          <td>${f.airline}</td>
          <td class="text-ellipsis" title="${f.dep_airport}">${f.dep_airport}</td>
          <td class="text-ellipsis" title="${f.arr_airport}">${f.arr_airport}</td>
          <td>${formatTime(f.dep_scheduled)}</td>
          <td>${formatTime(f.arr_scheduled)}</td>
          <td>${badgeStatus(f.status)}</td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-primary btn-save" data-number="${f.number}" data-kind="${kind}">
              <i class="bi bi-bookmark-plus"></i>
            </button>
          </td>
        </tr>
      `).join('')
    }

    function updateCharts(canvasAirlines, canvasStatus, flights){
      const countsByAirline = flights.reduce((acc, f) => { acc[f.airline] = (acc[f.airline]||0)+1; return acc }, {})
      const labelsAir = Object.entries(countsByAirline).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([k])=>k)
      const dataAir = labelsAir.map(l => countsByAirline[l])

      const statusKeys = Object.keys(STATUS_MAP)
      const dataSt = statusKeys.map(st => flights.filter(f => (f.status||'unknown')===st).length)
      const labelsSt = statusKeys.map(k => STATUS_MAP[k].label)

      if (charts[canvasAirlines.id]) charts[canvasAirlines.id].destroy()
      if (charts[canvasStatus.id]) charts[canvasStatus.id].destroy()

      charts[canvasAirlines.id] = new Chart(canvasAirlines.getContext('2d'), {
        type: 'bar',
        data: { labels: labelsAir, datasets: [{ label: 'Vuelos', data: dataAir }] },
        options: { responsive: true, plugins: { legend: { display: false } } }
      })

      charts[canvasStatus.id] = new Chart(canvasStatus.getContext('2d'), {
        type: 'doughnut',
        data: { labels: labelsSt, datasets: [{ label: 'Estatus', data: dataSt }] },
        options: { responsive: true }
      })
    }

    function toast(icon, title, text=''){
      Swal.fire({ icon, title, text, toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 })
    }

    function renderWatchlist(container, items){
      if (!items.length){
        container.innerHTML = '<div class="text-secondary">No tienes vuelos guardados.</div>'
        return
      }
      container.innerHTML = items.map(it => `
        <div class="card shadow-sm">
          <div class="card-body d-flex justify-content-between align-items-center gap-3">
            <div>
              <div class="fw-semibold">${it.number} — ${it.airline || ''}</div>
              <div class="small text-secondary">${it.dep_airport} → ${it.arr_airport}</div>
              <div class="small">${formatTime(it.dep_scheduled)} / ${formatTime(it.arr_scheduled)}</div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-outline-secondary btn-copy" data-json='${JSON.stringify(it).replace(/'/g, "&apos;")}'>
                <i class="bi bi-clipboard"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger btn-remove" data-number="${it.number}">
                <i class="bi bi-trash3"></i>
              </button>
            </div>
          </div>
        </div>
      `).join('')
    }

    function renderChips(containerId, codes){
      const container = byId(containerId)
      const names = codes.map(c => (airportsMX.find(a=>a.code===c)?.name) || c)
      container.innerHTML = names.map(n => `<span class="chip">${n}</span>`).join('')
    }

    return { renderTable, updateCharts, toast, renderWatchlist, renderChips }
  })()

  // ======== favoritos ========
  const Store = {
    getFavorites() { return JSON.parse(localStorage.getItem('favorites') || '[]') },
    setFavorites(arr) { localStorage.setItem('favorites', JSON.stringify(arr || [])) },
  }

  // ======== Utilidades ========
  function exportCSV(){
    const rows = Store.getFavorites()
    if (!rows.length){ return Swal.fire({icon:'info', title:'Nada para exportar', text:'Agrega vuelos a favoritos.'}) }
    const headers = ['numero','aerolinea','origen','destino','salida','llegada','estatus']
    const csvRows = [headers.join(',')]
    rows.forEach(r => {
      const line = [r.number, r.airline, r.dep_airport, r.arr_airport, r.dep_scheduled, r.arr_scheduled, r.status]
        .map(val => `"${(val||'').toString().replace(/"/g,'""')}"`).join(',')
      csvRows.push(line)
    })
    const blob = new Blob([csvRows.join('\n')], {type:'text/csv;charset=utf-8;'})
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'favoritos.csv'; a.click(); URL.revokeObjectURL(url)
  }

  // ======== App ========
  const App = (() => {
    let arrivalsCache = []
    let departuresCache = []
    let arrivalsView = []
    let departuresView = []
    let lastArrivalsUpdate = null
    let lastDeparturesUpdate = null

    function initSelects(){
      const fillAirports = (el) => { el.innerHTML = airportsMX.map(a => `<option value="${a.code}">${a.name}</option>`).join('') }
      fillAirports(byId('selectArrAirports')); fillAirports(byId('selectDepAirports'))

      const fillAirlinesSelect = (el) => { el.innerHTML += AIRLINES.map(n => `<option value="${n}">${n}</option>`).join('') }
      fillAirlinesSelect(byId('selectAirlineA')); fillAirlinesSelect(byId('selectAirlineD'))

      byId('datalistAirlines').innerHTML = AIRLINES.map(n => `<option value="${n}">`).join('')

      ;['selectArrAirports', 'selectDepAirports'].forEach(id => {
        const sel = byId(id); ['MEX','GDL'].forEach(code => { const opt = Array.from(sel.options).find(o=>o.value===code); if (opt) opt.selected = true })
      })

      const today = dayjs().format('YYYY-MM-DD')
      byId('inputArrDate').value = today
      byId('inputDepDate').value = today
      byId('inputFlightDate').value = today

      // Notas "Hoy" Solo mostrar vuelos del dia en curso
      const todayHuman = dayjs().format('DD MMM YYYY')
      const A = byId('todayNoteArr'); if (A) A.textContent = `Mostrando vuelos de hoy: ${todayHuman}`
      const D = byId('todayNoteDep'); if (D) D.textContent = `Mostrando vuelos de hoy: ${todayHuman}`
      const T = byId('todayNoteTrack'); if (T) T.textContent = `Fecha fija de hoy: ${todayHuman}`

      updateAirportChips('arr'); updateAirportChips('dep')
    }

    function bindEvents(){
      const debouncedSearchArr = debounce(()=> byId('formArrivals').dispatchEvent(new Event('submit')), 500)
      const debouncedSearchDep = debounce(()=> byId('formDepartures').dispatchEvent(new Event('submit')), 500)

      byId('selectArrAirports').addEventListener('change', () => { updateAirportChips('arr'); debouncedSearchArr() })
      byId('selectDepAirports').addEventListener('change', () => { updateAirportChips('dep'); debouncedSearchDep() })

      byId('formArrivals').addEventListener('submit', async (e) => {
        e.preventDefault()
        const mx = Array.from(byId('selectArrAirports').selectedOptions).map(o=>o.value)
        const airline = byId('selectAirlineA').value.trim()
        await loadArrivals(mx, airline)
        wireArrivalsFilters()
      })

      byId('formDepartures').addEventListener('submit', async (e) => {
        e.preventDefault()
        const mx = Array.from(byId('selectDepAirports').selectedOptions).map(o=>o.value)
        const airline = byId('selectAirlineD').value.trim()
        await loadDepartures(mx, airline)
        wireDeparturesFilters()
      })

      byId('formTrack').addEventListener('submit', async (e) => {
        e.preventDefault()
        const n = byId('inputFlightNumber').value.trim().toUpperCase()
        if (!n) return UI.toast('warning', 'Escribe el número de vuelo')
        await trackFlight(n)
      })

      byId('btnStatsArr').addEventListener('click', () => showStats('Llegadas', arrivalsView, lastArrivalsUpdate))
      byId('btnStatsDep').addEventListener('click', () => showStats('Salidas', departuresView, lastDeparturesUpdate))

      byId('tblArrivals').addEventListener('click', onTableButton)
      byId('tblDepartures').addEventListener('click', onTableButton)

      byId('offcanvasWatch').addEventListener('show.bs.offcanvas', refreshWatchlist)
      byId('watchlistContainer').addEventListener('click', (e) => {
        const btn = e.target.closest('button'); if (!btn) return
        if (btn.classList.contains('btn-remove')){
          const num = btn.dataset.number; const rest = Store.getFavorites().filter(f => f.number !== num)
          Store.setFavorites(rest); refreshWatchlist(); UI.toast('success','Eliminado de favoritos')
        }
        if (btn.classList.contains('btn-copy')){
          const data = btn.getAttribute('data-json'); navigator.clipboard.writeText(data).then(()=> UI.toast('success','Copiado al portapapeles'))
        }
      })

      byId('btnExportCSV').addEventListener('click', exportCSV)

      byId('year').textContent = new Date().getFullYear()
    }

    function updateAirportChips(kind){
      const sel = byId(kind === 'arr' ? 'selectArrAirports' : 'selectDepAirports')
      const codes = Array.from(sel.selectedOptions).map(o=>o.value)
      UI.renderChips(kind === 'arr' ? 'chipsArr' : 'chipsDep', codes)
    }

    function onTableButton(e){
      const btn = e.target.closest('button')
      if (!btn) return
      if (btn.classList.contains('btn-save')){
        const number = btn.dataset.number
        const tableId = e.currentTarget.id
        const list = tableId === 'tblArrivals' ? arrivalsView : departuresView
        const item = list.find(f => f.number === number)
        if (!item) return
        const favs = Store.getFavorites()
        if (favs.some(f=>f.number===item.number)){
          UI.toast('info','Ese vuelo ya está en favoritos')
          return
        }
        Store.setFavorites([item, ...favs].slice(0,50))
        UI.toast('success','Vuelo guardado')
      }
    }

    function refreshWatchlist(){ UI.renderWatchlist(byId('watchlistContainer'), Store.getFavorites()) }

    function showStats(title, flights, lastUpdate){
      const total = flights.length
      const byStatus = flights.reduce((acc,f)=>{acc[f.status]=(acc[f.status]||0)+1;return acc},{})

      const html = `
        <div class="text-start">
          <div class="mb-2"><strong>Total:</strong> ${total}</div>
          <div class="mb-2"><strong>Estatus:</strong> ${Object.entries(byStatus).map(([k,v]) => `${(STATUS_MAP[k]?.label||k)}: ${v}`).join(' · ') || '—'}</div>
          <div><strong>Última actualización:</strong> ${lastUpdate ? dayjs(lastUpdate).format('DD MMM YYYY, HH:mm:ss') : '—'}</div>
        </div>
      `
      Swal.fire({ icon:'info', title, html })
    }

    async function loadArrivals(mxAirports, airline){
      try{
        let flights = await AviationService.arrivals(mxAirports)
        flights = filterInitial(flights, airline)
        arrivalsCache = flights
        lastArrivalsUpdate = new Date()

        arrivalsView = flights.slice()
        renderArrivals()

      }catch(err){
        UI.toast('error','No se pudieron cargar llegadas (verifica tu API key y conexión)')
      }
    }

    async function loadDepartures(mxAirports, airline){
      try{
        let flights = await AviationService.departures(mxAirports)
        flights = filterInitial(flights, airline)
        departuresCache = flights
        lastDeparturesUpdate = new Date()

        departuresView = flights.slice()
        renderDepartures()

      }catch(err){
        UI.toast('error','No se pudieron cargar salidas (verifica tu API key y conexión)')
      }
    }

    function filterInitial(flights, airline){
      if (!airline) return flights
      const needle = normalizeStr(airline)
      return flights.filter(f => normalizeStr(f.airline).includes(needle))
    }

    function renderArrivals(){
      UI.renderTable(byId('tblArrivals').querySelector('tbody'), arrivalsView, 'arrivals')
      UI.updateCharts(byId('chartArrAirlines'), byId('chartArrStatus'), arrivalsView)
      if (!arrivalsView.length){ UI.toast('info','Sin resultados','Ajusta los filtros de tabla.') }
    }

    function renderDepartures(){
      UI.renderTable(byId('tblDepartures').querySelector('tbody'), departuresView, 'departures')
      UI.updateCharts(byId('chartDepAirlines'), byId('chartDepStatus'), departuresView)
      if (!departuresView.length){ UI.toast('info','Sin resultados','Ajusta los filtros de tabla.') }
    }

    function wireArrivalsFilters(){
      const f = { flight: byId('filterA_Flight'), airline: byId('filterA_Airline'), origin: byId('filterA_Origin'), depFrom: byId('filterA_DepFrom'), depTo: byId('filterA_DepTo'), status: byId('filterA_Status') }
      const handler = debounce(() => {
        arrivalsView = filterRows(arrivalsCache, { flight: f.flight.value, airline: f.airline.value, origin: f.origin.value, dest: '', depFrom: f.depFrom.value, depTo: f.depTo.value, arrFrom: '', arrTo: '', status: f.status.value })
        renderArrivals()
      }, 250)
      Object.values(f).forEach(input => { input.addEventListener('input', handler); input.addEventListener('change', handler) })
    }

    function wireDeparturesFilters(){
      const f = { flight: byId('filterD_Flight'), airline: byId('filterD_Airline'), dest: byId('filterD_Dest'), depFrom: byId('filterD_DepFrom'), depTo: byId('filterD_DepTo'), status: byId('filterD_Status') }
      const handler = debounce(() => {
        departuresView = filterRows(departuresCache, { flight: f.flight.value, airline: f.airline.value, origin: '', dest: f.dest.value, depFrom: f.depFrom.value, depTo: f.depTo.value, arrFrom: '', arrTo: '', status: f.status.value })
        renderDepartures()
      }, 250)
      Object.values(f).forEach(input => { input.addEventListener('input', handler); input.addEventListener('change', handler) })
    }

    async function trackFlight(number){
      const flight = await AviationService.trackByNumber(number)
      const box = byId('trackResult')
      if (!flight){
        box.innerHTML = `<div class="alert alert-warning">No se encontró el vuelo <strong>${number}</strong>. Intenta con otro número.</div>`
        return
      }
      box.innerHTML = `
        <div class="card shadow-sm">
          <div class="card-body d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div>
              <div class="h5 mb-0">${flight.number} — ${flight.airline || '—'}</div>
              <div class="text-secondary">${flight.dep_airport} <i class="bi bi-arrow-right-short"></i> ${flight.arr_airport}</div>
              <div class="small">Salida: ${formatTime(f.dep_scheduled)} | Llegada: ${formatTime(f.arr_scheduled)}</div>
              <div class="mt-1">${(function(){const m=STATUS_MAP[flight.status]||STATUS_MAP.unknown;return '<span class="badge rounded-pill text-bg-'+m.badge+'">'+m.label+'</span>'})()}</div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-outline-primary btn-icon" id="btnAssist"><i class="bi bi-headset"></i>Ayudar a mi cliente</button>
              <button class="btn btn-outline-success btn-icon" id="btnFav"><i class="bi bi-bookmark-plus"></i>Guardar</button>
            </div>
          </div>
        </div>
      `

      byId('btnFav').addEventListener('click', () => {
        const favs = Store.getFavorites()
        if (favs.some(f=>f.number===flight.number)){ UI.toast('info','Ese vuelo ya está en favoritos') }
        else { Store.setFavorites([flight, ...favs].slice(0,50)); UI.toast('success','Vuelo guardado') }
      })

      byId('btnAssist').addEventListener('click', async () => {
        const { value: formValues } = await Swal.fire({
          title: 'Solicitud de asistencia',
          html:
            '<input id="swal-name" class="swal2-input" placeholder="Nombre del cliente" value="Cliente ASM">' +
            '<input id="swal-email" type="email" class="swal2-input" placeholder="Email" value="cliente@correo.com">',
          focusConfirm: false,
          preConfirm: () => ({ name: document.getElementById('swal-name').value, email: document.getElementById('swal-email').value })
        })
        if (!formValues) return
        UI.toast('success','Solicitud registrada: te contactaremos por email')
      })
    }

    async function firstLoad(){
      initSelects()
      bindEvents()
      byId('formArrivals').dispatchEvent(new Event('submit'))
      byId('formDepartures').dispatchEvent(new Event('submit'))
    }

    return { firstLoad }
  })()

  window.addEventListener('DOMContentLoaded', App.firstLoad)
})()
