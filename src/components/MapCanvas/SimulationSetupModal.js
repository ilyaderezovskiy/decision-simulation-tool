// SimulationSetupModal.js
import React, { useState } from 'react';

const Tooltip = ({ text, children }) => {
  const [show, setShow] = useState(false);
  
  return (
    <div className="tooltip-container" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      {children}
      {show && <div className="tooltip">{text}</div>}
    </div>
  );
};

const SimulationSetupModal = ({ onClose, onConfirm, process, defaultParams }) => {
  const [maxIterations, setMaxIterations] = useState(defaultParams.maxIterations);
  const [numRuns, setNumRuns] = useState(defaultParams.numRuns);
  const [environmentParams, setEnvironmentParams] = useState(() => {
    const initialParams = {};
    const envParams = process?.process?.environmentParams || [];
    
    envParams.forEach(param => {
      const defaultValue = defaultParams.environmentParams[param.id] !== undefined 
        ? defaultParams.environmentParams[param.id] 
        : param.defaultValue;
      
      if (param.type === 'boolean') {
        initialParams[param.id] = {
          useRange: false,
          fixedValue: defaultValue,
        };
      } else {
        // Дефолтный интервал: ±10%, но не менее 0
        let minVal = defaultValue * 0.9;
        let maxVal = defaultValue * 1.1;
        
        if (param.type === 'integer') {
          minVal = Math.floor(minVal);
          maxVal = Math.ceil(maxVal);
        }
        
        if (param.min !== undefined) minVal = Math.max(minVal, param.min);
        if (param.max !== undefined) maxVal = Math.min(maxVal, param.max);
        if (minVal < 0) minVal = 0;
        
        initialParams[param.id] = {
          useRange: false,
          fixedValue: defaultValue,
          min: minVal,
          max: maxVal
        };
      }
    });
    
    return initialParams;
  });

  const [areaWidth, setAreaWidth] = useState(100);
  const [areaHeight, setAreaHeight] = useState(100);
  const [areaUnit, setAreaUnit] = useState('m');
  
  const handleConfirm = () => {
    let widthInMeters = areaWidth;
    let heightInMeters = areaHeight;
    if (areaUnit === 'km') {
      widthInMeters *= 1000;
      heightInMeters *= 1000;
    }
    
    // Формируем параметры для передачи (фиксированные значения для симуляции)
    const resolvedParams = {};
    const envParams = process?.process?.environmentParams || [];
    
    envParams.forEach(param => {
      const paramConfig = environmentParams[param.id];
      if (paramConfig.useRange) {
        // Для интервала используем фиксированное значение (среднее)
        resolvedParams[param.id] = paramConfig.fixedValue;
      } else {
        resolvedParams[param.id] = paramConfig.fixedValue;
      }
    });
    
    onConfirm({
      maxIterations,
      numRuns,
      environmentParams: resolvedParams,
      environmentParamRanges: environmentParams, // Сохраняем настройки интервалов
      areaSize: {
        width: widthInMeters,
        height: heightInMeters,
        unit: 'm'
      }
    });
  };

  const updateParamRange = (paramId, field, value) => {
    setEnvironmentParams(prev => ({
      ...prev,
      [paramId]: {
        ...prev[paramId],
        [field]: value
      }
    }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content simulation-setup-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Настройки моделирования</h3>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>
        
        <div className="modal-body">
          <div className="setup-section">
            <h4>Основные параметры</h4>
            
            <div className="form-group">
              <label>Макс. число итераций в моделировании:</label>
              <input
                type="number"
                min="1"
                max="10000"
                value={maxIterations}
                onChange={(e) => setMaxIterations(parseInt(e.target.value))}
              />
              <Tooltip text="Количество итераций в рамках одного моделирования. Чем больше итераций, тем дольше длится моделирование">
                <span className="help-icon">?</span>
              </Tooltip>
            </div>
            
            <div className="form-group">
              <label>Количество запусков моделирования:</label>
              <input
                type="number"
                min="1"
                max="100"
                value={numRuns}
                onChange={(e) => setNumRuns(parseInt(e.target.value))}
              />
              <Tooltip text="Количество запусков моделирования (для статистики). Многократный запуск позволяет получить более точные результаты">
                <span className="help-icon">?</span>
              </Tooltip>
            </div>
          </div>

          <div className="form-group">
            <label>Реальные размеры области моделирования:</label>
            <div className="size-input-group">
              <input
                type="number"
                step="0.1"
                value={areaWidth}
                onChange={(e) => setAreaWidth(parseFloat(e.target.value))}
                placeholder="Ширина"
                className="size-input"
              />
              <span> × </span>
              <input
                type="number"
                step="0.1"
                value={areaHeight}
                onChange={(e) => setAreaHeight(parseFloat(e.target.value))}
                placeholder="Высота"
                className="size-input"
              />
              <span>    </span>
              <select value={areaUnit} onChange={(e) => setAreaUnit(e.target.value)} className="unit-select">
                <option value="m">метров</option>
                <option value="km">километров</option>
              </select>
            </div>
            <small>Укажите реальные размеры нарисованной области на местности</small>
          </div>
          
          {process && process.process.environmentParams && process.process.environmentParams.length > 0 && (
            <div className="setup-section">
              <h4>Параметры среды</h4>
              <p className="section-description">Начальные значения параметров моделирования</p>
              
              {process.process.environmentParams.map(param => {
                const paramConfig = environmentParams[param.id];
                if (!paramConfig) return null;
                
                if (param.type === 'boolean') {
                  return (
                    <div className="form-group" key={param.id}>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={paramConfig.fixedValue}
                          onChange={(e) => updateParamRange(param.id, 'fixedValue', e.target.checked)}
                        />
                        <span>{param.name}</span>
                      </label>
                      {param.description && <Tooltip text={param.description}><span className="help-icon">?</span></Tooltip>}
                    </div>
                  );
                }
                
                return (
                  <div className="form-group range-param" key={param.id}>
                    <div className="param-header">
                      <label>
                        {param.name}
                        {param.description && <Tooltip text={param.description}><span className="help-icon">?</span></Tooltip>}
                        {param.unit && <span className="unit">({param.unit})</span>}
                      </label>
                      <div className="param-mode-switch">
                        <button 
                          type="button"
                          className={`mode-btn ${!paramConfig.useRange ? 'active' : ''}`}
                          onClick={() => updateParamRange(param.id, 'useRange', false)}
                        >
                          Фикс.
                        </button>
                        <button 
                          type="button"
                          className={`mode-btn ${paramConfig.useRange ? 'active' : ''}`}
                          onClick={() => updateParamRange(param.id, 'useRange', true)}
                        >
                          Интервал
                        </button>
                      </div>
                    </div>
                    
                    {!paramConfig.useRange ? (
                      <input
                        type="number"
                        step={param.step || (param.type === 'integer' ? 1 : 0.1)}
                        min={param.min !== undefined ? param.min : undefined}
                        max={param.max !== undefined ? param.max : undefined}
                        value={paramConfig.fixedValue}
                        onChange={(e) => {
                          let val = param.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value);
                          if (isNaN(val)) val = param.defaultValue;
                          updateParamRange(param.id, 'fixedValue', val);
                        }}
                      />
                    ) : (
                      <div className="range-inputs">
                        <div className="range-input">
                          <span className="range-label">от</span>
                          <input
                            type="number"
                            step={param.step || (param.type === 'integer' ? 1 : 0.1)}
                            value={paramConfig.min}
                            onChange={(e) => {
                              let val = param.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value);
                              if (isNaN(val)) val = 0;
                              if (param.min !== undefined) val = Math.max(val, param.min);
                              if (paramConfig.max !== undefined && val > paramConfig.max) val = paramConfig.max;
                              updateParamRange(param.id, 'min', val);
                              // Обновляем fixedValue на среднее
                              const newFixed = (val + paramConfig.max) / 2;
                              updateParamRange(param.id, 'fixedValue', newFixed);
                            }}
                          />
                        </div>
                        <div className="range-input">
                          <span className="range-label">до</span>
                          <input
                            type="number"
                            step={param.step || (param.type === 'integer' ? 1 : 0.1)}
                            value={paramConfig.max}
                            onChange={(e) => {
                              let val = param.type === 'integer' ? parseInt(e.target.value) : parseFloat(e.target.value);
                              if (isNaN(val)) val = 0;
                              if (param.max !== undefined) val = Math.min(val, param.max);
                              if (paramConfig.min !== undefined && val < paramConfig.min) val = paramConfig.min;
                              updateParamRange(param.id, 'max', val);
                              // Обновляем fixedValue на среднее
                              const newFixed = (paramConfig.min + val) / 2;
                              updateParamRange(param.id, 'fixedValue', newFixed);
                            }}
                          />
                        </div>
                        <span className="range-hint">при каждом запуске значение выбирается случайно</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Отмена</button>
          <button onClick={handleConfirm} className="confirm-btn">Подтвердить</button>
        </div>
      </div>
    </div>
  );
};

export default SimulationSetupModal;