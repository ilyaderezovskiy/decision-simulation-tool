import React, { useState } from 'react';

const SimulationControls = ({ isSimulationRunning, elements, simulationArea, startPoint }) => {
  const [params, setParams] = useState({
    windSpeed: 5,
    spreadIntensity: 8,
    temperature: 25,
    humidity: 60
  });

  const canStartSimulation = simulationArea && startPoint;

  const handleStart = () => {
    if (!canStartSimulation) {
      alert('Для запуска симуляции необходимо определить область моделирования и точку начала');
      return;
    }
    console.log('Симуляция запущена с параметрами:', params);
  };

  const handlePause = () => {
    console.log('Симуляция приостановлена');
  };

  const handleReset = () => {
    console.log('Симуляция сброшена');
  };

  const handleParamChange = (param, value) => {
    setParams(prev => ({
      ...prev,
      [param]: value
    }));
  };

  return (
    <div className="simulation-controls-panel">
      <h4>Управление симуляцией</h4>
      
      <div className="sim-controls">
        {!isSimulationRunning ? (
          <button 
            className="sim-btn start"
            onClick={handleStart}
            disabled={!canStartSimulation}
          >
            ▶ Запуск
          </button>
        ) : (
          <button className="sim-btn pause" onClick={handlePause}>
            ⏸ Пауза
          </button>
        )}
        <button className="sim-btn reset" onClick={handleReset}>
          ⏹ Сброс
        </button>
      </div>

      <div className="sim-params">
        <div className="sim-param">
          <span className="param-label">🌪️ Ветер:</span>
          <input
            type="range"
            min="0"
            max="20"
            step="0.5"
            value={params.windSpeed}
            onChange={(e) => handleParamChange('windSpeed', parseFloat(e.target.value))}
            className="param-slider"
          />
          <span className="param-value">{params.windSpeed} м/с</span>
        </div>

        <div className="sim-param">
          <span className="param-label">Интенсивность:</span>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={params.spreadIntensity}
            onChange={(e) => handleParamChange('spreadIntensity', parseInt(e.target.value))}
            className="param-slider"
          />
          <span className="param-value">{params.spreadIntensity}</span>
        </div>

        <div className="sim-param">
          <span className="param-label">Температура:</span>
          <input
            type="range"
            min="-10"
            max="50"
            step="1"
            value={params.temperature}
            onChange={(e) => handleParamChange('temperature', parseInt(e.target.value))}
            className="param-slider"
          />
          <span className="param-value">{params.temperature}°C</span>
        </div>
      </div>

      <div className="sim-stats">
        <div className="stat">
          <span>Объекты: {elements.filter(e => e.type === 'object').length}</span>
        </div>
        {!canStartSimulation && (
          <div className="warning">
            Для запуска симуляции задайте область и точку начала
          </div>
        )}
      </div>
    </div>
  );
};

export default SimulationControls;