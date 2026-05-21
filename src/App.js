import React, { useState, useCallback, useRef, useEffect } from 'react';
import DecisionTree from './components/DecisionTree/DecisionTree';
import ReportModal from './components/Analytics/ReportModal';
import MapCanvas from './components/MapCanvas/MapCanvas';
import TimelineVisualization from './components/TimelineVisualization/TimelineVisualization';
import eventLogger from './components/Analytics/EventLogger';
import './App.css';

function App() {
  const [isSimulationRunning, setIsSimulationRunning] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [selectedObject, setSelectedObject] = useState(null);
  
  const [simulationState, setSimulationState] = useState(null);
  const [selectedProcess, setSelectedProcess] = useState(null);
  const [elements, setElements] = useState([]);
  
  // Состояния для визуализации
  const [eventsForTimeline, setEventsForTimeline] = useState([]); // Только текущие события для визуализации
  const [currentRunIndex, setCurrentRunIndex] = useState(-1);
  const [isShowingHistory, setIsShowingHistory] = useState(false);
  const [allRuns, setAllRuns] = useState([]); // Храним все завершенные запуски
  const currentRunEventsRef = useRef([]);

  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState([]);

  // Функция получения параметров
  const getAvailableParams = () => {
    const params = [];
    elements.forEach(el => {
      if (el.type === 'object' && el.properties) {
        Object.keys(el.properties).forEach(key => {
          if (key !== 'currentState' && key !== 'custom') {
            params.push({
              id: `object.${el.id}.${key}`,
              name: `${el.label || 'Объект'}.${key}`,
              category: 'object'
            });
          }
        });
      }
    });
    
    if (selectedProcess && selectedProcess.process?.environmentParams) {
      selectedProcess.process.environmentParams.forEach(param => {
        params.push({
          id: `env.${param.id}`,
          name: param.name,
          category: 'environment'
        });
      });
    }
    
    return params;
  };

  const handleSimulationToggle = (running) => {
    setIsSimulationRunning(running);
    if (running) {
      // Новый запуск - очищаем ref
      currentRunEventsRef.current = [];
      eventLogger.clear();
      eventLogger.startRun(1);
      // Показываем текущий запуск (очищаем историю из визуализации)
      setEventsForTimeline([]);
      setIsShowingHistory(false);
      setCurrentRunIndex(-1);
    } else {
      // Симуляция остановлена - сохраняем текущий запуск в историю
      const currentEvents = currentRunEventsRef.current;
      if (currentEvents.length > 0) {
        const runNumber = allRuns.length + 1;
        const runWithNumbers = currentEvents.map(e => ({ ...e, run_number: runNumber }));
        setAllRuns(prev => [...prev, { runNumber, events: runWithNumbers }]);
      }
    }
  };

  // Обработчики для получения данных из MapCanvas
  const handleSimulationStateChange = (state) => {
    setSimulationState(state);
  };
  
  const handleSelectedProcessChange = (process) => {
    setSelectedProcess(process);
  };
  
  const handleElementsChange = (newElements) => {
    setElements(newElements);
  };
  
  const handleStepChange = (step) => {
    setCurrentStep(step);
  };

  const mapCanvasRef = useRef(null);

  const handleObjectActionsApply = useCallback((actions) => {
    setElements(prev => prev.map(el => {
      const action = actions.find(a => a.objectId === el.id);
      if (!action) return el;
      return { ...el, properties: { ...el.properties, [action.property]: action.value } };
    }));
    mapCanvasRef.current?.applyObjectActions?.(actions);
  }, []);

  const handleExecutionConditionFailed = ({ nodeId, nodeName, description }) => {
    alert(`⚠️ Условие выполнения нарушено!\nДействие: "${nodeName}"\n${description}\n\nВыполнение плана приостановлено.`);
    setIsSimulationRunning(false);
  };

  // Отслеживаем изменения в eventLogger
  useEffect(() => {
    const originalAdd = eventLogger._add.bind(eventLogger);
    const originalClear = eventLogger.clear.bind(eventLogger);
    const originalClearForNewRun = eventLogger._clearForNewRun.bind(eventLogger);
    const originalEndAction = eventLogger.endAction.bind(eventLogger);

    eventLogger._add = function(data) {
      const result = originalAdd(data);
      const currentEvents = eventLogger.getEvents();
      currentRunEventsRef.current = [...currentEvents];
      // Если не в режиме истории, показываем текущие события
      if (!isShowingHistory) {
        setEventsForTimeline([...currentEvents]);
      }
      return result;
    };

    eventLogger.endAction = function(actionId, elapsedSec) {
      const result = originalEndAction(actionId, elapsedSec);
      const currentEvents = eventLogger.getEvents();
      currentRunEventsRef.current = [...currentEvents];
      if (!isShowingHistory) {
        setEventsForTimeline([...currentEvents]);
      }
      return result;
    };

    eventLogger.clear = function() {
      originalClear();
      currentRunEventsRef.current = [];
      if (!isShowingHistory) {
        setEventsForTimeline([]);
      }
    };

    eventLogger._clearForNewRun = function() {
      originalClearForNewRun();
      currentRunEventsRef.current = [];
      if (!isShowingHistory) {
        setEventsForTimeline([]);
      }
    };

    return () => {
      eventLogger._add = originalAdd;
      eventLogger.clear = originalClear;
      eventLogger._clearForNewRun = originalClearForNewRun;
      eventLogger.endAction = originalEndAction;
    };
  }, [isShowingHistory]);

  // Функция для показа конкретного запуска из истории
  const handleShowRunFromHistory = useCallback((runNumber) => {
    const run = allRuns.find(r => r.runNumber === runNumber);
    if (run) {
      setEventsForTimeline(run.events);
      setCurrentRunIndex(runNumber - 1);
      setIsShowingHistory(true);
    }
  }, [allRuns]);

  // Функция для возврата к текущему запуску
  const handleBackToCurrentRun = useCallback(() => {
    setEventsForTimeline(currentRunEventsRef.current);
    setCurrentRunIndex(-1);
    setIsShowingHistory(false);
  }, []);

  // Функция для сбора данных из всех запусков
  const collectReportData = useCallback(() => {
    const allRunData = [];
    
    // Собираем данные из allRuns (завершённые запуски)
    allRuns.forEach(run => {
      const runInfo = extractRunInfo(run.events);
      allRunData.push({
        runNumber: run.runNumber,
        ...runInfo,
        events: run.events
      });
    });
    
    // Добавляем текущий запуск если есть события
    if (eventsForTimeline.length > 0 && !isShowingHistory) {
      const currentRunInfo = extractRunInfo(eventsForTimeline);
      allRunData.push({
        runNumber: allRuns.length + 1,
        ...currentRunInfo,
        events: eventsForTimeline,
        isCurrent: true
      });
    }
    
    setReportData(allRunData);
    setShowReport(true);
  }, [allRuns, eventsForTimeline, isShowingHistory]);

  const handleCsvLoaded = useCallback((csvRunData) => {
    // Сохраняем данные из CSV как "запуски" для отчёта
    setAllRuns(csvRunData.map(run => ({
      runNumber: run.runNumber,
      events: run.events
    })));
  }, []);

  // Извлечение информации из событий
  const extractRunInfo = (events) => {
    let maxThreatLevel = 'Нет';
    let damagedObjects = 0;
    let destroyedObjects = 0;
    let localizationTime = null;
    let localizationSuccess = false;
    
    // Карта уровней угроз
    const threatLevels = {
      'Т1': 1, 'М1': 1, 'Х1': 1,
      'Т2': 2, 'М2': 2, 'Х2': 2,
      'Т3': 3, 'М3': 3, 'Х3': 3
    };
    
    let maxLevel = 0;
    
    events.forEach(event => {
      const activity = event.activity || '';
      const attributes = event.attributes || {};
      
      // Поиск максимального уровня угрозы
      Object.keys(threatLevels).forEach(level => {
        if (activity.includes(level)) {
          if (threatLevels[level] > maxLevel) {
            maxLevel = threatLevels[level];
            maxThreatLevel = level;
          }
        }
      });
      
      // Поиск в атрибутах impactCode
      if (attributes.impactCode) {
        Object.keys(threatLevels).forEach(level => {
          if (attributes.impactCode.includes(level)) {
            if (threatLevels[level] > maxLevel) {
              maxLevel = threatLevels[level];
              maxThreatLevel = level;
            }
          }
        });
      }
      
      // Количество повреждённых/уничтоженных объектов
      if (event.type === 'object') {
        if (activity.includes('разрушен') || activity.includes('destroyed') || 
            (attributes.description && attributes.description.includes('необратимое'))) {
          destroyedObjects++;
        } else if (activity.includes('повреждён') || activity.includes('damaged')) {
          damagedObjects++;
        }
      }
      
      // Время локализации и успех
      if (activity.includes('локализация') || activity.includes('ликвидация')) {
        localizationTime = event.timestamp_begin;
        if (activity.includes('успех') || activity.includes('success') || 
            (attributes.outcome === 'success')) {
          localizationSuccess = true;
        }
      }
    });
    
    // Проверка завершающего события
    const endEvent = events.find(e => e.type === 'system' && e.activity?.includes('Завершение'));
    if (endEvent?.attributes?.outcome === 'success') {
      localizationSuccess = true;
    }
    
    return {
      maxThreatLevel,
      threatLevelValue: maxLevel,
      damagedObjects,
      destroyedObjects,
      totalDamaged: damagedObjects + destroyedObjects,
      localizationTime,
      localizationSuccess,
      localizationSuccessValue: localizationSuccess ? 1 : 0
    };
  };

  return (
    <div className="App">
      <div className="top-section">
        <div className="decision-tree-section">
          <DecisionTree 
            isSimulationRunning={isSimulationRunning}
            onRunChange={handleSimulationToggle}
            currentStep={currentStep}
            simulationState={simulationState}
            selectedProcess={selectedProcess}
            elements={elements}
            getAvailableParams={getAvailableParams}
            onObjectActionsApply={handleObjectActionsApply}
            onExecutionConditionFailed={handleExecutionConditionFailed}
          />
        </div>

        <div className="map-section">
          <MapCanvas ref={mapCanvasRef}
            isSimulationRunning={isSimulationRunning}
            selectedObject={selectedObject}
            onObjectSelect={setSelectedObject}
            onSimulationToggle={handleSimulationToggle}
            onSimulationStateChange={handleSimulationStateChange}
            onSelectedProcessChange={handleSelectedProcessChange}
            onElementsChange={handleElementsChange}
            onStepChange={handleStepChange}
            onObjectActionsApply={handleObjectActionsApply}
            onShowRunFromHistory={handleShowRunFromHistory}
          />
        </div>
      </div>

      <div className="bottom-section">
        <TimelineVisualization 
          events={eventsForTimeline}
          currentRunIndex={currentRunIndex}
          isShowingHistory={isShowingHistory}
          elements={elements}
          allRuns={allRuns}
          onRunSelect={handleShowRunFromHistory}
          onBackToCurrent={handleBackToCurrentRun}
          onShowReport={() => {
            collectReportData();
            setShowReport(true);
          }}
          onCsvLoaded={handleCsvLoaded}
        />

        {showReport && (
          <ReportModal 
            reportData={reportData}
            onClose={() => setShowReport(false)}
            onSelectRun={handleShowRunFromHistory}
          />
        )}
      </div>
    </div>
  );
}

export default App;