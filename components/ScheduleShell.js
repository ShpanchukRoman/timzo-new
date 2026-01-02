import Script from 'next/script';

export default function ScheduleShell({ shareToken = '' }) {
  const shareScript = shareToken
    ? `window.__SHARE_TOKEN__ = ${JSON.stringify(shareToken)};`
    : '';

  return (
    <>
      <main>
        <div id="share-banner" className="share-info-banner hidden"></div>
        <section className="container">
          <h1>Планування графіку працівників</h1>

          <div className="controls">
            <div className="controls-row">
              <div className="week-selector">
                <label htmlFor="week">Обрати тиждень:</label>
                <input type="week" id="week" name="week" />
              </div>
              <div className="controls-actions">
                <button id="share-trigger" className="primary-btn" aria-expanded="false" aria-controls="share-inline-panel">
                  Поділитися
                </button>
                <button id="clear-schedule" className="ghost-btn danger">Очистити</button>
              </div>
            </div>
            <div id="share-inline-panel" className="share-inline-panel hidden">
              <form id="share-form" className="share-inline-form">
                <div className="share-fields">
                  <label className="share-field">
                    <span>Тиждень</span>
                    <input type="week" id="share-week" required />
                  </label>
                </div>
                <div className="share-actions">
                  <button type="submit" className="primary-btn">Згенерувати посилання</button>
                  <div className="share-exports">
                    <button id="export-pdf" type="button">Експорт в PDF</button>
                    <button id="export-jpg" type="button">Експорт в JPG</button>
                  </div>
                </div>
                <p className="hint">Створене посилання відкриває розклад лише для перегляду.</p>
              </form>
              <div id="share-result" className="share-result hidden"></div>
            </div>
          </div>

          <div className="limits-row">
            <div className="label-cell">Ліміт годин на день</div>
            <div className="day-cell" data-day="0">
              <input type="number" className="day-limit-input" defaultValue="26" />
            </div>
            <div className="day-cell" data-day="1">
              <input type="number" className="day-limit-input" defaultValue="26" />
            </div>
            <div className="day-cell" data-day="2">
              <input type="number" className="day-limit-input" defaultValue="26" />
            </div>
            <div className="day-cell" data-day="3">
              <input type="number" className="day-limit-input" defaultValue="26" />
            </div>
            <div className="day-cell" data-day="4">
              <input type="number" className="day-limit-input" defaultValue="26" />
            </div>
            <div className="day-cell" data-day="5">
              <input type="number" className="day-limit-input" defaultValue="20" />
            </div>
            <div className="day-cell" data-day="6">
              <input type="number" className="day-limit-input" defaultValue="20" />
            </div>
            <div className="total-cell" id="week-limit-total">0</div>
          </div>

          <div className="table-header">
            <div className="label-cell">Працівники</div>
            <div className="day-cell">Понеділок</div>
            <div className="day-cell">Вівторок</div>
            <div className="day-cell">Середа</div>
            <div className="day-cell">Четвер</div>
            <div className="day-cell">П&apos;ятниця</div>
            <div className="day-cell">Субота</div>
            <div className="day-cell">Неділя</div>
            <div className="total-cell">Години працівників</div>
          </div>

          <div id="employees-container">
            <div className="empty-state">Дані будуть доступні після підключення сервера.</div>
          </div>

          <div className="add-employee">
            <button id="add-employee-btn" className="ghost-btn">Додати працівника</button>
          </div>

          <div className="used-hours-row">
            <div className="label-cell">Використані години в день</div>
            <div className="day-cell" data-day="0">0</div>
            <div className="day-cell" data-day="1">0</div>
            <div className="day-cell" data-day="2">0</div>
            <div className="day-cell" data-day="3">0</div>
            <div className="day-cell" data-day="4">0</div>
            <div className="day-cell" data-day="5">0</div>
            <div className="day-cell" data-day="6">0</div>
            <div className="total-cell">0</div>
          </div>
          <div id="limit-alerts" className="limit-alerts" aria-live="polite" aria-hidden="true"></div>
        </section>

        <section className="timeline-container">
          <div className="timeline-header">
            <div className="timeline-title">
              <h2>Таймлайн дня</h2>
              <div className="timeline-day-label" id="timeline-day-label">Немає даних</div>
            </div>
            <div className="timeline-controls">
              <label className="timeline-date-picker">
                <span>Дата:</span>
                <input type="date" id="timeline-date" />
              </label>
              <button type="button" id="timeline-toggle" className="timeline-toggle">Сховати</button>
            </div>
          </div>
          <div className="timeline-scale" id="timeline-scale"></div>
          <div className="timeline-body" id="timeline-body"></div>
        </section>

        <section className="stats-container">
          <h2>Статистика</h2>

          <div className="stats-tabs">
            <button className="stats-tab active" data-stats="week">За тиждень</button>
            <button className="stats-tab" data-stats="month">За місяць</button>
            <button className="stats-tab" data-stats="all">За весь час</button>
            <button className="stats-tab" data-stats="employee">Детальна по працівнику</button>
          </div>

          <div className="stats-panels">
            <div className="stats-panel active" data-stats="week">
              <div className="stats-overview">
                <div className="summary-item">
                  <span className="summary-label">Загальні години</span>
                  <span className="summary-value" id="total-week-hours">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Середні години на працівника</span>
                  <span className="summary-value" id="average-week-hours">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Використання тижневого ліміту</span>
                  <span className="summary-value" id="limit-usage-percent">0%</span>
                  <div className="progress-bar">
                    <div className="progress-fill" id="limit-usage-bar"></div>
                  </div>
                </div>
              </div>

              <div className="employee-stats-card">
                <div className="employee-stats-header">
                  <span className="col-name">Працівник</span>
                  <span className="col-position">Посада</span>
                  <span className="col-days">Роб./Вих.</span>
                  <span className="col-hours">Години</span>
                  <span className="col-average">Середнє</span>
                </div>
                <div id="employee-stats-body" className="employee-stats-body"></div>
              </div>
            </div>

            <div className="stats-panel" data-stats="month">
              <div className="stats-overview">
                <div className="summary-item">
                  <span className="summary-label">Години за місяць</span>
                  <span className="summary-value" id="total-month-hours">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">План на місяць</span>
                  <span className="summary-value" id="month-plan-total">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Виконання плану</span>
                  <span className="summary-value" id="month-plan-percent">0%</span>
                  <div className="progress-bar">
                    <div className="progress-fill" id="month-plan-bar"></div>
                  </div>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Залишок плану</span>
                  <span className="summary-value" id="month-plan-remaining">0</span>
                </div>
              </div>

              <div className="plan-controls">
                <label className="plan-field">
                  <span>Планові години на місяць (всього)</span>
                  <input type="number" id="month-plan-total-input" min="0" step="0.25" />
                </label>
                <button type="button" id="month-plan-save" className="primary-btn">Зберегти план</button>
              </div>

              <div className="employee-plan-card">
                <div className="employee-plan-header">
                  <span className="col-name">Працівник</span>
                  <span className="col-position">Посада</span>
                  <span className="col-hours">Факт (місяць)</span>
                  <span className="col-hours">План (місяць)</span>
                  <span className="col-average">% місяця</span>
                  <span className="col-average">% тижня</span>
                  <span className="col-average">Залишок</span>
                </div>
                <div id="employee-plan-body" className="employee-plan-body"></div>
              </div>
            </div>

            <div className="stats-panel" data-stats="all">
              <div className="stats-overview">
                <div className="summary-item">
                  <span className="summary-label">Години за весь час</span>
                  <span className="summary-value" id="total-all-hours">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Середні години на працівника</span>
                  <span className="summary-value" id="average-all-hours">0</span>
                </div>
              </div>

              <div className="employee-plan-card">
                <div className="employee-plan-header compact">
                  <span className="col-name">Працівник</span>
                  <span className="col-position">Посада</span>
                  <span className="col-hours">Години</span>
                </div>
                <div id="employee-all-body" className="employee-plan-body"></div>
              </div>
            </div>

            <div className="stats-panel" data-stats="employee">
              <div className="employee-detail-controls">
                <label className="plan-field">
                  <span>Працівник</span>
                  <select id="employee-detail-select"></select>
                </label>
              </div>

              <div className="stats-overview">
                <div className="summary-item">
                  <span className="summary-label">Години за тиждень</span>
                  <span className="summary-value" id="employee-week-hours">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Години за місяць</span>
                  <span className="summary-value" id="employee-month-hours">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Години за весь час</span>
                  <span className="summary-value" id="employee-all-hours">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">План на місяць</span>
                  <span className="summary-value" id="employee-plan-hours">0</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">% виконання (місяць)</span>
                  <span className="summary-value" id="employee-plan-percent">0%</span>
                </div>
                <div className="summary-item">
                  <span className="summary-label">Залишок плану</span>
                  <span className="summary-value" id="employee-plan-remaining">0</span>
                </div>
              </div>

              <div className="plan-controls">
                <label className="plan-field">
                  <span>Оновити план працівника (місяць)</span>
                  <input type="number" id="employee-plan-input" min="0" step="0.25" />
                </label>
                <button type="button" id="employee-plan-save" className="primary-btn">Зберегти план</button>
              </div>

              <div className="employee-chart-card">
                <div className="employee-chart-controls">
                  <button type="button" className="employee-chart-range active" data-range="7">7 днів</button>
                  <button type="button" className="employee-chart-range" data-range="14">14 днів</button>
                  <button type="button" className="employee-chart-range" data-range="30">30 днів</button>
                </div>
                <div id="employee-chart-bars" className="employee-chart-bars"></div>
              </div>
            </div>
          </div>
        </section>

        <div className="made-by">зроблено у wave.ri - shpanchuk roman</div>
      </main>
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js" strategy="beforeInteractive" />
      <Script src="https://html2canvas.hertzen.com/dist/html2canvas.min.js" strategy="beforeInteractive" />
      <Script src="https://cdnjs.cloudflare.com/ajax/libs/qrious/4.0.2/qrious.min.js" strategy="beforeInteractive" />
      {shareScript ? (
        <Script id="share-token" strategy="beforeInteractive">{shareScript}</Script>
      ) : null}
      <Script src="/schedule.js" strategy="afterInteractive" />
    </>
  );
}
