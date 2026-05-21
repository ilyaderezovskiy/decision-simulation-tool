// ReportModal.jsx
import React, { useState, useMemo } from 'react';
import './ReportModal.css';

const ReportModal = ({ reportData, onClose, onSelectRun }) => {
  const [sortBy, setSortBy] = useState('default');
  const [weights, setWeights] = useState({
    success: 0.6,
    time: 0.4,
    threat: 0,
    damage: 0
  });
  const [showWeightSettings, setShowWeightSettings] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  
  // Проверка суммы весов
  const totalWeight = weights.success + weights.time + weights.threat + weights.damage;
  const areWeightsValid = Math.abs(totalWeight - 1.0) < 0.01;
  
  // Нормализация значений для подсчёта коэффициента
  const normalizeValue = (value, min, max) => {
    if (max === min) return 0.5;
    if (value === undefined || value === null) return 0;
    return (value - min) / (max - min);
  };
  
  const extractSelectedAction = (events) => {
    if (!events || !Array.isArray(events) || events.length === 0) return '—';
    const decisionEvent = events.find(e => e.type === 'decision');
    if (decisionEvent) {
      return decisionEvent.attributes?.selectedBranch || decisionEvent.activity || '—';
    }
    return '—';
  };
  
  // Сортировка и расчёт коэффициентов
  const sortedData = useMemo(() => {
    if (!reportData || reportData.length === 0) {
      return [];
    }
    
    const times = reportData.map(d => d.localizationTime || 0);
    const damages = reportData.map(d => d.totalDamaged || 0);
    const threats = reportData.map(d => d.threatLevelValue || 0);
    
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const minDamage = Math.min(...damages);
    const maxDamage = Math.max(...damages);
    const minThreat = Math.min(...threats);
    const maxThreat = Math.max(...threats);
    
    const dataWithScore = reportData.map(item => {
      const selectedAction = extractSelectedAction(item.events || []);
      
      const normTime = normalizeValue(item.localizationTime || maxTime, minTime, maxTime);
      const normDamage = normalizeValue(item.totalDamaged || 0, minDamage, maxDamage);
      const normThreat = normalizeValue(item.threatLevelValue || 0, minThreat, maxThreat);
      
      const successComp = (weights.success || 0) * (item.localizationSuccessValue || 0);
      const timeComp = (weights.time || 0) * (1 - normTime);
      const threatComp = (weights.threat || 0) * (1 - normThreat);
      const damageComp = (weights.damage || 0) * (1 - normDamage);
      
      let score = 0;
      
      switch (sortBy) {
        case 'threat':
          score = item.threatLevelValue || 0;
          break;
        case 'damage':
          score = -(item.totalDamaged || 0);
          break;
        case 'time':
          score = -(item.localizationTime || 999999);
          break;
        case 'success':
          score = item.localizationSuccessValue || 0;
          break;
        case 'custom':
          if (!areWeightsValid) {
            // Если веса некорректны, показываем предупреждение и используем веса по умолчанию
            score = 0.6 * (item.localizationSuccessValue || 0) +
                    0.4 * (1 - normTime);
          } else {
            score = (weights.success || 0) * (item.localizationSuccessValue || 0) +
                    (weights.time || 0) * (1 - normTime) +
                    (weights.damage || 0) * (1 - normDamage) +
                    (weights.threat || 0) * (1 - normThreat);
          }
          break;
        default:
          score = item.runNumber;
      }
      
      return { 
        ...item, 
        score, 
        selectedAction,
        formulaDetails: `${successComp.toFixed(3)}+${timeComp.toFixed(3)}+${threatComp.toFixed(3)}+${damageComp.toFixed(3)}`
      };
    });
    
    return dataWithScore.sort((a, b) => {
      if (sortBy === 'default') return a.runNumber - b.runNumber;
      if (sortBy === 'time') return (a.localizationTime || 999999) - (b.localizationTime || 999999);
      if (sortBy === 'damage') return a.totalDamaged - b.totalDamaged;
      return b.score - a.score;
    });
  }, [reportData, sortBy, weights]);
  
  const getThreatColor = (level) => {
    if (!level || level === 'Нет') return '#6b7280';
    if (level.includes('3')) return '#ef4444';
    if (level.includes('2')) return '#f59e0b';
    if (level.includes('1')) return '#eab308';
    return '#10b981';
  };
  
  const formatTime = (seconds) => {
    if (!seconds) return '—';
    if (seconds < 60) return `${seconds.toFixed(0)} с`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} мин ${Math.floor(seconds % 60)} с`;
    return `${Math.floor(seconds / 3600)} ч ${Math.floor((seconds % 3600) / 60)} мин`;
  };
  
  const updateWeight = (key, value) => {
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 1) {
      setWeights(prev => ({ ...prev, [key]: numValue }));
    }
  };
  
  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal-content" onClick={e => e.stopPropagation()}>
        <div className="report-modal-header">
          <h3>Отчёт по запускам моделирования</h3>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>
        
        <div className="report-controls">
          <div className="sort-controls">
            <label>Сортировка:</label>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="default">По номеру запуска</option>
              <option value="threat">Максимальный уровень угрозы</option>
              <option value="damage">Количество повреждённых объектов</option>
              <option value="time">Время локализации угрозы</option>
              <option value="success">Успех локализации угрозы</option>
              <option value="custom">Пользовательский коэффициент</option>
            </select>
          </div>
          
          {sortBy === 'custom' && (
            <button 
              className="weights-btn"
              onClick={() => setShowWeightSettings(!showWeightSettings)}
            >
              Настройка параметров
            </button>
          )}
        </div>
        
        {sortBy === 'custom' && showWeightSettings && (
          <div className="weights-panel">
            <h4 style={{ display: 'inline-block', marginRight: '8px' }}>
              Настройка весов параметров
            </h4>
            <div style={{ display: 'inline-block', verticalAlign: 'middle', cursor: 'help' }} title="Сумма весов должна быть равна 1 для корректного расчёта коэффициента. Нормирование приводит разные показатели (время, угрозы, повреждения) к единому диапазону 0–1, после чего итоговый коэффициент рассчитывается как взвешенная сумма. Чем выше коэффициент, тем успешнее сценарий.">
              ⓘ
            </div>
            <div className="weights-grid">
              <div className="weight-item">
                <label>Успех локализации угрозы</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.success}
                  onChange={(e) => updateWeight('success', e.target.value)}
                />
                <span>{Math.round(weights.success * 100)}%</span>
              </div>
              <div className="weight-item">
                <label>Время локализации угрозы</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.time}
                  onChange={(e) => updateWeight('time', e.target.value)}
                />
                <span>{Math.round(weights.time * 100)}%</span>
              </div>
              <div className="weight-item">
                <label>Уровень угрозы</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.threat}
                  onChange={(e) => updateWeight('threat', e.target.value)}
                />
                <span>{Math.round(weights.threat * 100)}%</span>
              </div>
              <div className="weight-item">
                <label>Количество повреждений</label>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={weights.damage}
                  onChange={(e) => updateWeight('damage', e.target.value)}
                />
                <span>{Math.round(weights.damage * 100)}%</span>
              </div>
            </div>
            
            <div className="weight-sum-info">
              <span>Сумма весов: {totalWeight.toFixed(2)}</span>
              {!areWeightsValid && (
                <span className="weight-warning">Сумма должна быть равна 1! Используются веса по умолчанию (0.6 и 0.4)</span>
              )}
              {areWeightsValid && sortBy === 'custom' && (
                <span className="weight-success">✓ Коэффициент рассчитывается с вашими весами</span>
              )}
              <button 
                className="details-toggle-btn"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? 'Скрыть расчёт' : 'Подробности расчёта'}
              </button>
            </div>
            
            {showDetails && sortBy === 'custom' && (
              <div className="formula-details-section">
                <div className="formula-preview">
                  <strong>Итоговый коэффициент</strong> = {weights.success.toFixed(2)} × Успех + 
                  {weights.time.toFixed(2)} × (1 - t<sub>норм</sub>) + 
                  {weights.threat.toFixed(2)} × (1 - У<sub>норм</sub>) + 
                  {weights.damage.toFixed(2)} × (1 - П<sub>норм</sub>)
                </div>
                
                <div className="formulas-list">
                  <strong>Расчёт для каждого запуска:</strong>
                  <div className="formulas-scroll">
                    {sortedData.map(run => {
                      // Пересчитываем нормализованные значения для этого запуска
                      const times = sortedData.map(d => d.localizationTime || 0);
                      const damages = sortedData.map(d => d.totalDamaged || 0);
                      const threats = sortedData.map(d => d.threatLevelValue || 0);
                      
                      const minTime = Math.min(...times);
                      const maxTime = Math.max(...times);
                      const minDamage = Math.min(...damages);
                      const maxDamage = Math.max(...damages);
                      const minThreat = Math.min(...threats);
                      const maxThreat = Math.max(...threats);
                      
                      const tNorm = maxTime === minTime ? 0.5 : ((run.localizationTime || maxTime) - minTime) / (maxTime - minTime);
                      const uNorm = maxThreat === minThreat ? 0.5 : ((run.threatLevelValue || 0) - minThreat) / (maxThreat - minThreat);
                      const pNorm = maxDamage === minDamage ? 0.5 : ((run.totalDamaged || 0) - minDamage) / (maxDamage - minDamage);
                      
                      const successTerm = (weights.success * (run.localizationSuccessValue || 0)).toFixed(3);
                      const timeTerm = (weights.time * (1 - tNorm)).toFixed(3);
                      const threatTerm = (weights.threat * (1 - uNorm)).toFixed(3);
                      const damageTerm = (weights.damage * (1 - pNorm)).toFixed(3);
                      
                      return (
                        <div key={run.runNumber} className="formula-item">
                          <div className="formula-run">Запуск #{run.runNumber}:</div>
                          <div className="formula-expression">
                            <strong>{run.score.toFixed(4)} </strong> = 
                            <span className="term"> {successTerm} </span> + 
                            <span className="term"> {timeTerm} </span> + 
                            <span className="term"> {threatTerm} </span> + 
                            <span className="term"> {damageTerm}</span>
                          </div>
                          <div className="formula-details">
                            <span className="detail">t<sub>норм</sub>={tNorm.toFixed(3)} </span>
                            <span className="detail">У<sub>норм</sub>={uNorm.toFixed(3)} </span>
                            <span className="detail">П<sub>норм</sub>={pNorm.toFixed(3)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        
        <div className="report-table-container">
          <table className="report-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Выбранное действие (Decision node)</th>
                <th>Макс. уровень угрозы</th>
                <th>Повреждено объектов</th>
                <th>Уничтожено объектов</th>
                <th>Всего</th>
                <th>Время локализации угрозы</th>
                <th>Успех локализации угрозы</th>
                {sortBy === 'custom' && <th>Коэффициент</th>}
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map((run) => (
                <tr key={run.runNumber} className={run.isCurrent ? 'current-run' : ''}>
                  <td>#{run.runNumber}{run.isCurrent && <span className="current-badge">текущий</span>}</td>
                  <td className="action-cell">
                    <span className="action-badge">{run.selectedAction || '—'}</span>
                  </td>
                  <td>
                    <span 
                      className="threat-badge"
                      style={{ backgroundColor: getThreatColor(run.maxThreatLevel) }}
                    >
                      {run.maxThreatLevel !== 'Нет' ? run.maxThreatLevel : '—'}
                    </span>
                  </td>
                  <td>{run.damagedObjects || 0}</td>
                  <td>{run.destroyedObjects || 0}</td>
                  <td>{run.totalDamaged || 0}</td>
                  <td>{formatTime(run.localizationTime)}</td>
                  <td>
                    <span className={`success-badge ${run.localizationSuccess ? 'success' : 'failed'}`}>
                      {run.localizationSuccess ? '✅ Да' : '❌ Нет'}
                    </span>
                  </td>
                  {sortBy === 'custom' && (
                    <td className="score-cell" title={`Расчёт: ${run.formulaDetails}`}>
                      {run.score.toFixed(4)}
                    </td>
                  )}
                  <td>
                    <button 
                      className="view-run-btn"
                      onClick={() => {
                        onSelectRun?.(run.runNumber);
                        onClose();
                      }}
                    >
                      Просмотр визуализации
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        <div className="report-footer">
          <span>Всего запусков: {reportData?.length || 0}</span>
        </div>
      </div>
    </div>
  );
};

export default ReportModal;