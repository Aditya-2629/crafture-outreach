/**
 * Crafture Network — Overview Data Visualizations Engine
 * ApexCharts-powered Radial Bar, Conversion Funnel, and Weekly Area Chart.
 * Forest Green (#104B35) + Accent (#43C878) + Secondary (#167448)
 */

/**
 * Render animated SaaS charts in the dashboard overview.
 * @param {HTMLElement} container
 * @param {object} stats
 * @returns {{ destroy: () => void }}
 */
export function renderDashboardCharts(container, stats = {}) {
  if (!container) return { destroy: () => {} };

  // Destroy previous charts in this container if any
  if (container._activeCharts) {
    container._activeCharts.forEach((c) => {
      try {
        if (c && typeof c.destroy === 'function') c.destroy();
      } catch (e) {
        console.warn('[Overview Charts] destroy error', e);
      }
    });
  }
  container._activeCharts = [];

  // Extract or default live stats
  const quotas = stats.quotas || {};
  const inviteQuota = quotas.invite || {};
  const usedInvites = inviteQuota.usedToday ?? 0;
  const maxInvites = inviteQuota.max ?? (stats.config?.dailyInviteCap || 25);
  const quotaPct = Math.min(100, Math.round((usedInvites / maxInvites) * 100));

  const funnelData = stats.funnel || [0, 0, 0, 0, 0];
  const weeklyData = stats.weekly || [0, 0, 0, 0, 0, 0, 0];

  // Shell HTML
  container.innerHTML = `
    <div class="canvas-grid">
      <!-- Chart 1: Radial Quota Gauge -->
      <div class="chart-card glass-card">
        <div class="chart-card-head">
          <div class="chart-title">Daily Quota Velocity</div>
          <span class="chart-badge">${usedInvites} of ${maxInvites} Used</span>
        </div>
        <div class="chart-body" id="chart-radial-quota"></div>
        <div class="chart-foot">
          <span>Safe anti-detection ceiling · resets midnight</span>
        </div>
      </div>

      <!-- Chart 2: Weekly Velocity Area Chart -->
      <div class="chart-card glass-card">
        <div class="chart-card-head">
          <div class="chart-title">Weekly Touch Velocity</div>
          <span class="chart-badge">Mon – Sun</span>
        </div>
        <div class="chart-body" id="chart-area-weekly"></div>
        <div class="chart-foot">
          <span>Outreach interactions across sequence batches</span>
        </div>
      </div>
    </div>

    <!-- Chart 3: Conversion Funnel Full Width -->
    <div class="chart-card glass-card chart-card-full">
      <div class="chart-card-head">
        <div>
          <div class="chart-title">Conversion Funnel</div>
          <div class="chart-sub">End-to-end drop-off & response conversion analysis</div>
        </div>
        <span class="chart-badge chart-badge-mint">45.6% Acceptance</span>
      </div>
      <div class="chart-body" id="chart-funnel-bar"></div>
    </div>
  `;

  const ChartConstructor = window.ApexCharts;
  if (!ChartConstructor) {
    console.warn('[Overview Charts] ApexCharts not loaded');
    return { destroy: () => {} };
  }

  // 1. Radial Daily Quota Gauge
  const radialEl = container.querySelector('#chart-radial-quota');
  let radialChart = null;
  if (radialEl) {
    radialChart = new ChartConstructor(radialEl, {
      chart: {
        type: 'radialBar',
        height: 220,
      },
      series: [quotaPct],
      colors: ['#104B35', '#43C878'],
      labels: ['Daily Invites'],
      plotOptions: {
        radialBar: {
          dataLabels: {
            total: {
              formatter: () => `${usedInvites} / ${maxInvites} Sent`,
            },
          },
        },
      },
    });
    radialChart.render();
    container._activeCharts.push(radialChart);
  }

  // 2. Weekly Velocity Area Chart
  const weeklyEl = container.querySelector('#chart-area-weekly');
  let weeklyChart = null;
  if (weeklyEl) {
    weeklyChart = new ChartConstructor(weeklyEl, {
      chart: {
        type: 'area',
        height: 220,
        toolbar: { show: false },
        animations: {
          enabled: true,
          easing: 'easeinout',
          speed: 400,
        },
      },
      series: [
        {
          name: 'Interactions',
          data: weeklyData,
        },
      ],
      xaxis: {
        categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        labels: {
          hideOverlappingLabels: true,
          rotate: 0,
          style: {
            colors: '#64748b',
            fontSize: '11px',
            fontFamily: 'inherit',
          },
        },
        tickAmount: 7,
      },
      tooltip: {
        theme: 'light',
        x: { show: true },
        transition: {
          duration: 150,
        },
      },
      colors: ['#104B35'],
      fill: {
        type: 'gradient',
        gradient: {
          shadeIntensity: 1,
          opacityFrom: 0.35,
          opacityTo: 0.05,
          stops: [0, 95, 100],
        },
      },
    });
    weeklyChart.render();
    container._activeCharts.push(weeklyChart);
  }

  // 3. Crafture Network Conversion Funnel Bar
  const funnelEl = container.querySelector('#chart-funnel-bar');
  let funnelChart = null;
  if (funnelEl) {
    funnelChart = new ChartConstructor(funnelEl, {
      chart: {
        type: 'bar',
        height: 260,
        toolbar: { show: false },
      },
      plotOptions: {
        bar: {
          horizontal: true,
          borderRadius: 6,
        },
      },
      series: [
        {
          name: 'Prospects',
          data: funnelData,
        },
      ],
      xaxis: {
        categories: [
          'Enrolled Leads',
          'Profile Visits',
          'Invites Sent',
          'Connections Accepted',
          'Replies Received',
        ],
        labels: {
          hideOverlappingLabels: true,
          style: {
            colors: '#64748b',
            fontSize: '11px',
            fontFamily: 'inherit',
          },
        },
      },
      tooltip: {
        theme: 'light',
        transition: {
          duration: 150,
        },
      },
      colors: ['#104B35', '#167448', '#43C878'],
    });
    funnelChart.render();
    container._activeCharts.push(funnelChart);
  }

  return {
    destroy() {
      container._activeCharts.forEach((c) => {
        try {
          if (c && typeof c.destroy === 'function') c.destroy();
        } catch {}
      });
      container._activeCharts = [];
    },
  };
}

