import React, { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Stage, Layer, Image, Circle, Line, Text, Group, Rect } from 'react-konva';
import './MapCanvas.css';
import eventLogger from '../Analytics/EventLogger';
import SimulationSetupModal from './SimulationSetupModal';
import { saveProject, openProjectFile, relinkProcess } from './projectManager';
import { validateProcess } from './processValidator.js';
import fireProcess from '../../user_processes/fireProcess.js';
import floodProcess from '../../user_processes/floodProcess.js';
import warehouseFireProcess from '../../user_processes/warehouseFireProcess.js';
import {
  initializeSimulation,
  stepSimulation,
  isSimulationComplete,
  getCellColor,
  isObjectAffected,
  isEventPointInZone
} from './simulationEngine';

const MapCanvas = forwardRef(({ 
  isSimulationRunning, 
  selectedObject, 
  onObjectSelect, 
  onSimulationToggle, 
  onSimulationComplete,
  onSimulationStateChange,
  onSelectedProcessChange,
  onElementsChange,
  onStepChange  }, ref) => {

  useImperativeHandle(ref, () => ({
    applyObjectActions: (actions) => {
      setElements(prev => prev.map(el => {
        const action = actions.find(a => a.objectId === el.id);
        if (!action) return el;

        // Логируем изменение свойства объекта
        const oldValue = el.properties?.[action.property];
        const newValue = action.value;
        
        if (oldValue !== newValue) {
          console.log(`[ACTION] Изменение объекта "${el.label || el.objectType}": ${action.property} = ${newValue} (было: ${oldValue})`);

          eventLogger.objectChanged({
            objectId:      el.id,
            objectName:    el.label || el.objectType || el.id,
            objectType:    el.objectType,
            property:      action.property,
            previousValue: oldValue,
            newValue:      newValue,
            iteration:     simulationIterationsRef.current,
            causeId:       action.nodeId || 'decision_tree_action',
            attributes: {
              objectLabel:      el.label,
              objectType:       el.objectType,
              position:         { x: el.x, y: el.y },
              allProperties:    el.properties || {},
              changedBy:        'decision_tree',
            }
          });
        }
        return { ...el, properties: { ...el.properties, [action.property]: action.value } };
      }));

      if (simulationStateRef.current?.objectsInArea) {
        simulationStateRef.current.objectsInArea.forEach(obj => {
          const action = actions.find(a => a.objectId === obj.id);
          if (!action) return;
          obj.properties = { ...obj.properties, [action.property]: action.value };
        });
      }
    }
  }));
  
  const stageRef = useRef(null);
  const containerRef = useRef(null);
  const stageContainerRef = useRef(null);
  const completionFiredRef = useRef(false);
  const currentRunParamsRef = useRef({});
  const [image, setImage] = useState(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState('select');
  const [elements, setElements] = useState([]);
  const [polygonPoints, setPolygonPoints] = useState([]);
  const [tempLine, setTempLine] = useState(null);
  const [simulationArea, setSimulationArea] = useState(null);
  const [startPoint, setStartPoint] = useState(null);
  const [showProperties, setShowProperties] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [showSimulationSettings, setShowSimulationSettings] = useState(false);
  const [simulationTime, setSimulationTime] = useState(0);
  const [simulationIterations, setSimulationIterations] = useState(0);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  // Состояние для выбранного процесса моделирования
  const [selectedProcess, setSelectedProcess] = useState(null);
  // Состояние для параметров среды
  const [environmentParams, setEnvironmentParams] = useState({});
  // Состояние для отображения модального окна с кодом процесса
  const [showProcessCode, setShowProcessCode] = useState(false);
  const [selectedProcessForCode, setSelectedProcessForCode] = useState(null);
  // Состояние для отображения окна настроек моделирования
  const [showSimulationSetup, setShowSimulationSetup] = useState(false);
  const [pendingStartPoint, setPendingStartPoint] = useState(null);

  const [simulationHistory, setSimulationHistory] = useState([]); // История запусков
  const [currentRunIndex, setCurrentRunIndex] = useState(-1); // Текущий отображаемый запуск
  const [isShowingHistory, setIsShowingHistory] = useState(false); // Режим просмотра истории
  const [completedRunsInCurrentSession, setCompletedRunsInCurrentSession] = useState(0); // Завершено в текущей сессии
  const [totalRunsToComplete, setTotalRunsToComplete] = useState(0); // Сколько нужно сделать запусков
  const [isBatchRunning, setIsBatchRunning] = useState(false); // Режим пакетного запуска

  const [realTime, setRealTime] = useState(0); // Реальное время в секундах
  const [simulationStartTime, setSimulationStartTime] = useState(null); // Время запуска

  const [currentRunParams, setCurrentRunParams] = useState({});

  // Состояние для создания/редактирования события
  const [pendingEventPos, setPendingEventPos] = useState(null);
  const [eventCondition, setEventCondition] = useState({
    triggerOnImpact: true,
    rules: []
  });
  const [eventName, setEventName] = useState('');
  const [eventRadius, setEventRadius] = useState(6);
  const [eventType, setEventType] = useState('fire');

  const [eventTriggerType, setEventTriggerType] = useState('single');

  const [simulationState, setSimulationState] = useState(null); // Текущее состояние клеточного автомата
  const [affectedObjects, setAffectedObjects] = useState(new Set()); // ID объектов, попавших в зону
  const [triggeredEvents, setTriggeredEvents] = useState(new Set()); // ID сработавших событий

  const [simState, setSimState] = useState(null);
  const [simulationInterval, setSimulationInterval] = useState(null);

  // Состояние для доступных процессов
  const [availableProcesses, setAvailableProcesses] = useState([
    {
      id: 'fire',
      name: 'Пожар',
      icon: '🔥',
      process: fireProcess,
      source: 'default'
    },
    {
      id: 'flood',
      name: 'Наводнение',
      icon: '🌊',
      process: floodProcess,
      source: 'default'
    },
    {
      id: 'warehouseFireProcess',
      name: 'Тушение пожара',
      icon: '🔥',
      process: warehouseFireProcess,
      source: 'default'
    }
  ]);
  
  const [simulationConfig, setSimulationConfig] = useState({
    maxIterations: 150,
    numRuns: 5,
    environmentParams: {}
  });
  
  const [objectProperties, setObjectProperties] = useState({
    name: '',
    type: 'wood_object',
    resistance: 50,
    capacity: 0,
    customProps: {}
  });
  
  const [eventPointProperties, setEventPointProperties] = useState({
    name: '',
    eventType: 'fire',
    threshold: 50,
    customProps: {}
  });

  // Ссылка на текущее состояние для использования в интервале
  const simulationStateRef = useRef(simulationState);
  const elementsRef = useRef(elements);
  const affectedObjectsRef = useRef(affectedObjects);
  const triggeredEventsRef = useRef(triggeredEvents);

  const completedRunsRef = useRef(0);
  const simulationConfigRef = useRef(simulationConfig);
  const realTimeRef = useRef(0);
  const simulationIterationsRef = useRef(0);

  useEffect(() => { simulationConfigRef.current = simulationConfig; }, [simulationConfig]);
  useEffect(() => { realTimeRef.current = realTime; }, [realTime]);
  useEffect(() => { simulationIterationsRef.current = simulationIterations; }, [simulationIterations]);

  useEffect(() => {
    simulationStateRef.current = simulationState;
  }, [simulationState]);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    affectedObjectsRef.current = affectedObjects;
  }, [affectedObjects]);

  useEffect(() => {
    triggeredEventsRef.current = triggeredEvents;
  }, [triggeredEvents]);

  // При изменении simulationState передаем в родитель
  useEffect(() => {
    if (onSimulationStateChange && simulationState) {
      onSimulationStateChange(simulationState);
    }
  }, [simulationState, onSimulationStateChange]);

  // При изменении selectedProcess передаем в родитель
  useEffect(() => {
    if (onSelectedProcessChange && selectedProcess) {
      onSelectedProcessChange(selectedProcess);
    }
  }, [selectedProcess, onSelectedProcessChange]);

  // При изменении elements передаем в родитель
  useEffect(() => {
    if (onElementsChange) {
      onElementsChange(elements);
    }
  }, [elements, onElementsChange]);

  // При изменении simulationIterations передаем в родитель
  useEffect(() => {
    if (onStepChange) {
      onStepChange(simulationIterations);
    }
  }, [simulationIterations, onStepChange]);

  useEffect(() => {
    if (!isSimulationRunning) return;

    const timerInterval = setInterval(() => {
      if (simulationStartTime) {
        setRealTime((Date.now() - simulationStartTime) / 1000);
      }
    }, 500);

    return () => clearInterval(timerInterval);
  }, [isSimulationRunning, simulationStartTime]);

  // Функция выбора процесса
  const handleProcessSelect = (process) => {
    setSelectedProcess(process);
    
    if (process) {
      // Получаем данные процесса из process.process (для загруженных) 
      // или из самого process (для стандартных)
      const processData = process.process || process;
      
      // 1. ИЗВЛЕКАЕМ ТИПЫ ОБЪЕКТОВ ИЗ ПРОЦЕССА
      if (processData.objectTypes && processData.objectTypes.length > 0) {
        // Полностью заменяем типы объектов на те, что в процессе
        const newObjectTypes = processData.objectTypes.map(objType => ({
          id: objType.id,
          name: objType.name,
          icon: objType.icon || '📦',
          props: objType.defaultProperties || {},
          source: 'process',
          processId: process.id,
          description: objType.description || ''
        }));
        
        setObjectTypes(newObjectTypes);
        console.log('Обновлены типы объектов:', newObjectTypes.map(t => t.name));
      } else {
        // Если в процессе нет типов объектов, очищаем список
        setObjectTypes([]);
        console.log('В процессе нет типов объектов');
      }
      
      // 2. ИЗВЛЕКАЕМ ПАРАМЕТРЫ СРЕДЫ
      if (processData.environmentParams && processData.environmentParams.length > 0) {
        // Создаем объект с параметрами среды для отображения в настройках
        const envParams = processData.environmentParams.reduce((acc, param) => {
          acc[param.id] = {
            ...param,
            currentValue: param.defaultValue
          };
          return acc;
        }, {});
        
        // Сохраняем параметры среды в состояние
        setEnvironmentParams(envParams);
        
        // Создаем объект со значениями по умолчанию
        const defaultEnvironmentValues = processData.environmentParams.reduce((acc, param) => {
          acc[param.id] = param.defaultValue;
          return acc;
        }, {});
        
        // Обновляем конфигурацию симуляции с параметрами среды
        setSimulationConfig(prev => ({
          ...prev,
          environmentParams: defaultEnvironmentValues
        }));
        
        console.log('Обновлены параметры среды:', processData.environmentParams.map(p => p.name));
      } else {
        console.log('В процессе нет параметров среды');
      }
      
      // Для отладки показываем информацию
      const objectTypeNames = processData.objectTypes ? processData.objectTypes.map(t => t.name).join(', ') : '(нет)';
      const envParamNames = processData.environmentParams ? processData.environmentParams.map(p => p.name).join(', ') : '(нет)';
      
      alert(`Выбран процесс: ${process.name}\n\nТипы объектов в процессе (${processData.objectTypes?.length || 0}):\n${objectTypeNames}\n\nПараметры среды (${processData.environmentParams?.length || 0}):\n${envParamNames}`);
    }
  };

  // Функция для показа кода процесса
  const handleShowProcessCode = (process) => {
    setSelectedProcessForCode(process);
    setShowProcessCode(true);
  };

  // Функция для добавления своего процесса
  const handleAddCustomProcess = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js,.json';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const sourceCode = event.target.result;
          let loadedProcess = null;
          
          // Пробуем разные способы загрузки
          try {
            // Способ 1: Пробуем как JSON
            loadedProcess = JSON.parse(sourceCode);
          } catch (jsonError) {
            // Способ 2: Пробуем как JavaScript модуль
            try {
              // Создаем функцию для выполнения кода
              // Поддерживаем оба формата: export default и module.exports
              const moduleObj = { exports: {} };
              
              // Заменяем export default на module.exports =
              let modifiedCode = sourceCode;
              
              // Обрабатываем export default
              if (sourceCode.includes('export default')) {
                // Извлекаем имя экспортируемой переменной
                const exportMatch = sourceCode.match(/export\s+default\s+(\w+)/);
                if (exportMatch) {
                  const exportName = exportMatch[1];
                  modifiedCode = sourceCode.replace(/export\s+default\s+\w+/, 
                    `module.exports = ${exportName}`);
                } else {
                  // Если export default с объектом
                  modifiedCode = sourceCode.replace(/export\s+default\s+{/, 
                    'module.exports = {');
                }
              }
              
              // Обрабатываем export const/let/var
              modifiedCode = modifiedCode.replace(/export\s+(const|let|var)\s+/g, '$1 ');
              
              const func = new Function('module', 'exports', modifiedCode + '; return module.exports;');
              loadedProcess = func(moduleObj, moduleObj.exports);
            } catch (jsError) {
              console.error('JS parse error:', jsError);
              throw new Error('Не удалось распарсить файл. Убедитесь, что файл содержит валидный JSON или JavaScript объект.');
            }
          }
          
          // Проверяем, что получили объект
          if (!loadedProcess || typeof loadedProcess !== 'object') {
            throw new Error('Файл не содержит валидный объект процесса');
          }
          
          // Проверяем валидность процесса
          const validation = validateProcess(loadedProcess);
          
          if (!validation.isValid) {
            alert('Ошибка валидации процесса:\n' + validation.errors.join('\n'));
            return;
          }

          // Проверяем, нет ли уже процесса с таким ID
          const existingProcess = availableProcesses.find(p => p.id === loadedProcess.id);
          
          let processId = loadedProcess.id;
          let processName = loadedProcess.name;
          
          // Если процесс с таким ID уже существует, добавляем дату
          if (existingProcess) {
            const date = new Date();
            const dateStr = `${date.getDate()}_${date.getMonth() + 1}_${date.getFullYear()}`;
            processId = `${loadedProcess.id}_${dateStr}`;
            processName = `${loadedProcess.name} (${dateStr})`;
          }

          // Создаём объект процесса
          const newProcess = {
            id: processId,
            name: processName,
            icon: loadedProcess.icon || '⚡',
            
            // Сохраняем исходный код
            sourceCode: sourceCode,
            
            // Сохраняем весь процесс
            process: loadedProcess,
            
            // Извлекаем данные
            objectTypes: loadedProcess.objectTypes || [],
            environmentParams: loadedProcess.environmentParams || [],
            defaultEnvironmentValues: (loadedProcess.environmentParams || []).reduce((acc, param) => {
              acc[param.id] = param.defaultValue;
              return acc;
            }, {}),
            functions: {
              initialize: loadedProcess.initialize,
              step: loadedProcess.step,
              isComplete: loadedProcess.isComplete,
              getCellColor: loadedProcess.getCellColor
            },
            
            // Метаданные
            source: 'user',
            file: file.name,
            uploadDate: new Date().toISOString(),
            validationWarnings: validation.warnings || []
          };

          // Добавляем процесс в список доступных
          setAvailableProcesses(prev => [...prev, newProcess]);
          
          // Автоматически выбираем добавленный процесс
          handleProcessSelect(newProcess);
          
          // Показываем предупреждения, если есть
          if (validation.warnings && validation.warnings.length > 0) {
            console.warn('Предупреждения при загрузке процесса:', validation.warnings);
            alert(`Процесс "${loadedProcess.name}" загружен с предупреждениями:\n${validation.warnings.join('\n')}`);
          } else {
            // alert(`Процесс "${loadedProcess.name}" успешно загружен!\n\nТипов объектов: ${loadedProcess.objectTypes?.length || 0}\nПараметров среды: ${loadedProcess.environmentParams?.length || 0}`);
          }
          
        } catch (err) {
          console.error('Error loading process:', err);
          alert('Ошибка при загрузке процесса: ' + err.message);
        }
      };
      reader.readAsText(file);
    };

    input.click();
  };

  const saveCurrentRunToHistory = useCallback((runNumber, finalState) => {
    const stateToSave = finalState || simulationStateRef.current;
    if (!stateToSave) return null;
    
    const runData = {
      id: Date.now(),
      runNumber,
      timestamp: new Date().toISOString(),
      simulationState: JSON.parse(JSON.stringify(stateToSave)),
      affectedObjects: Array.from(affectedObjectsRef.current),
      triggeredEvents: Array.from(triggeredEventsRef.current),
      elements: JSON.parse(JSON.stringify(elementsRef.current)),
      iterations: stateToSave.iteration,
      realTime: realTime,
      environmentParams: { ...currentRunParamsRef.current }
    };
    
    setSimulationHistory(prev => [...prev, runData]);
    return runData;
  }, []);

  // Компонент модального окна для отображения кода процесса
  const ProcessCodeModal = ({ process, onClose }) => {
    if (!process) return null;
    
    // Форматируем код для отображения
    const processCode = process.source === 'default' 
      ? JSON.stringify(process.process, null, 2)
      : `// Процесс: ${process.name}\n// Файл: ${process.file || 'неизвестно'}\n// Загружен: ${process.uploadDate || 'стандартный'}\n\n${JSON.stringify(process.process, null, 2)}`;
    
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content process-code-modal" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>
              <span className="process-icon">{process.icon}</span>
              Код процесса: {process.name}
              {process.source === 'user' && <span className="user-badge">Пользовательский</span>}
            </h3>
            <button onClick={onClose} className="close-btn">✕</button>
          </div>
          <div className="modal-body">
            <pre className="code-block">
              {processCode}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  // Обновление размера Stage при изменении размера контейнера
  useEffect(() => {
    const updateStageSize = () => {
      if (stageContainerRef.current) {
        const container = stageContainerRef.current;
        const newWidth = container.clientWidth;
        const newHeight = container.clientHeight;
        setStageSize({ width: newWidth, height: newHeight });
        
        if (image) {
          fitImageToContainer();
        }
      }
    };
    
    updateStageSize();
    
    const resizeObserver = new ResizeObserver(updateStageSize);
    if (stageContainerRef.current) {
      resizeObserver.observe(stageContainerRef.current);
    }
    
    return () => {
      if (stageContainerRef.current) {
        resizeObserver.unobserve(stageContainerRef.current);
      }
    };
  }, [image]);

  // Сбрасываем черновик при закрытии панели свойств
  useEffect(() => {
    if (!showProperties) {
      // Если панель закрылась не через добавление объекта (например, по крестику)
      // сбрасываем временные данные
      if (pendingObjectPos && !selectedObject) {
        setPendingObjectPos(null);
        setNewObjectDraft({
          name: '',
          objectTypeId: '',
          properties: {},
          isNewType: false,
          newTypeId: '',
          newTypeName: '',
          saveType: false
        });
      }
    }
  }, [showProperties]);

  useEffect(() => {
    if (!isSimulationRunning || !simulationState || !selectedProcess) return;
    
    const actualProcess = selectedProcess.process || selectedProcess;
    if (isSimulationComplete(simulationState, actualProcess, simulationConfig.maxIterations)) {
      if (completionFiredRef.current) return; // защита от двойного срабатывания
      completionFiredRef.current = true;
      handleCompleteSimulation(simulationState); // передаём финальный стейт явно
    }
  }, [simulationState]); // зависит только от стейта
  
  // Обработка движения мыши для временной линии полигона
  useEffect(() => {
    if (!stageRef.current || polygonPoints.length === 0 || tool !== 'polygon') {
      setTempLine(null);
      return;
    }
    
    const stage = stageRef.current;
    
    const handleMouseMove = (e) => {
      const pos = stage.getPointerPosition();
      if (!pos) return;
      
      const transform = stage.getAbsoluteTransform().copy();
      transform.invert();
      const scaledPos = transform.point(pos);
      
      if (polygonPoints.length > 0) {
        const lastPoint = polygonPoints[polygonPoints.length - 1];
        setTempLine({
          points: [lastPoint.x, lastPoint.y, scaledPos.x, scaledPos.y],
          stroke: '#3b82f6',
          strokeWidth: 2,
          dash: [5, 5]
        });
      }
    };
    
    // Обработка двойного клика для завершения полигона
    const handleDblClick = (e) => {
      if (polygonPoints.length >= 3) {
        completePolygon();
      } else {
        alert('Для завершения полигона необходимо минимум 3 точки');
      }
    };
    
    stage.on('mousemove', handleMouseMove);
    stage.on('dblclick', handleDblClick);
    
    return () => {
      stage.off('mousemove');
      stage.off('dblclick');
    };
  }, [tool, polygonPoints]);

  // Загрузка изображения через кнопку в top-toolbar
  const handleImageUploadFromButton = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,.tif,.tiff,.geotiff';
    input.onchange = (e) => handleImageUpload(e);
    input.click();
  };

  // Загрузка изображения
  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new window.Image();
      img.onload = () => {
        setImage(img);
        setTimeout(() => fitImageToContainer(), 100);
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  // Подгонка изображения под контейнер
  const fitImageToContainer = useCallback(() => {
    if (!image || !stageContainerRef.current) return;
    
    const container = stageContainerRef.current;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    const scaleX = containerWidth / image.width;
    const scaleY = containerHeight / image.height;
    const newScale = Math.min(scaleX, scaleY) * 0.95;
    
    setScale(newScale);
    setPosition({ 
      x: (containerWidth - image.width * newScale) / 2, 
      y: (containerHeight - image.height * newScale) / 2 
    });
  }, [image]);

  // Функция завершения полигона
  const completePolygon = useCallback(() => {
    if (polygonPoints.length < 3) {
      alert(`Для завершения полигона необходимо минимум 3 точки. Сейчас: ${polygonPoints.length}`);
      return;
    }
    
    const newArea = {
      id: `area_${Date.now()}`,
      type: 'simulationArea',
      points: [...polygonPoints, polygonPoints[0]].flatMap(p => [p.x, p.y]),
      fill: 'rgba(59, 130, 246, 0.3)',
      stroke: '#3b82f6',
      strokeWidth: 2,
      closed: true,
      draggable: false
    };
    
    setElements(prev => [...prev, newArea]);
    setSimulationArea(newArea);
    setPolygonPoints([]);
    setTempLine(null);
    setTool('select');
    
  }, [polygonPoints]);

  // Проверка точки внутри полигона
  const isPointInPolygon = (point, polygonPoints) => {
    if (!polygonPoints || polygonPoints.length < 6) return false;
    
    let wn = 0;
    const vertices = [];
    
    // Преобразуем массив точек [x1, y1, x2, y2, ...] в массив объектов {x, y}
    for (let i = 0; i < polygonPoints.length; i += 2) {
      vertices.push({ x: polygonPoints[i], y: polygonPoints[i + 1] });
    }
    
    // Алгоритм winding number
    for (let i = 0; i < vertices.length; i++) {
      const j = (i + 1) % vertices.length;
      
      if (vertices[i].y <= point.y) {
        if (vertices[j].y > point.y && 
            isLeft(vertices[i], vertices[j], point) > 0) {
          wn++;
        }
      } else {
        if (vertices[j].y <= point.y && 
            isLeft(vertices[i], vertices[j], point) < 0) {
          wn--;
        }
      }
    }
    
    return wn !== 0;
  };
  
  const isLeft = (p0, p1, p2) => {
    return (p1.x - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (p1.y - p0.y);
  };

  // Обработка кликов на карте
  const handleStageClick = useCallback((e) => {
    if (!image || !stageRef.current) return;
  
    const stage = stageRef.current;
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;
  
    const transform = stage.getAbsoluteTransform().copy();
    transform.invert();
  
    const scaledPos = transform.point(pointerPos);
  
    if (
      scaledPos.x < 0 || scaledPos.x > image.width ||
      scaledPos.y < 0 || scaledPos.y > image.height
    ) {
      return;
    }
  
    switch (tool) {
      case 'polygon':
        handlePolygonClick(scaledPos);
        break;
      case 'point':
        handlePointClick(scaledPos);
        break;
      case 'object':
        handleObjectClick(scaledPos);
        break;
      case 'event':
        handleEventPointClick(scaledPos);
        break;
      default:
        handleSelectClick(scaledPos);
    }
  }, [image, tool, simulationArea, startPoint]);

  // Обработка клика для полигона
  const handlePolygonClick = (scaledPos) => {
    if (simulationArea) {
      alert('Область моделирования уже определена. Удалите существующую для создания новой.');
      return;
    }
    
    // Убираем автоматическое создание первой точки при первом клике
    // Просто добавляем точку к существующим
    setPolygonPoints(prev => {
      const newPoints = [...prev, scaledPos];
      
      // Проверяем, можно ли замкнуть полигон (если есть 3+ точки и кликнули близко к первой)
      if (newPoints.length >= 3) {
        const firstPoint = newPoints[0];
        const distance = Math.sqrt(
          Math.pow(scaledPos.x - firstPoint.x, 2) + 
          Math.pow(scaledPos.y - firstPoint.y, 2)
        );
        
        // Если кликнули близко к первой точке (в пределах 15px) - замыкаем полигон
        if (distance < 15) {
          setTimeout(() => completePolygon(), 10); // Небольшая задержка для плавности
          return prev; // Возвращаем старые точки, так как полигон завершится
        }
      }
      
      return newPoints;
    });
  };

  // Отмена рисования полигона
  const cancelPolygon = () => {
    if (polygonPoints.length > 0) {
      if (window.confirm('Отменить рисование полигона? Все точки будут удалены.')) {
        setPolygonPoints([]);
        setTempLine(null);
        setTool('select');
      }
    } else {
      setTool('select');
    }
  };

  // Обработка клика для точки начала
  const handlePointClick = (scaledPos) => {
    if (!simulationArea) {
      alert('Сначала определите область моделирования');
      setTool('polygon');
      return;
    }
    
    if (startPoint) {
      alert('Точка начала моделирования уже задана');
      return;
    }
    
    if (!isPointInPolygon(scaledPos, simulationArea.points)) {
      alert('Точка начала должна находиться внутри области моделирования');
      return;
    }

    // Сохраняем временную точку начала
    const tempStartPoint = {
      type: 'startPoint',
      x: scaledPos.x,
      y: scaledPos.y,
      radius: 5,
      fill: '#ef4444',
      stroke: '#fff',
      strokeWidth: 2,
      draggable: true,
      label: 'Начало моделирования'
    };
    
    // Устанавливаем временную точку и открываем окно настроек
    setPendingStartPoint(tempStartPoint);
    setShowSimulationSetup(true);
    setTool('select');
  };

  // Функция подтверждения настроек и создания точки начала
  const confirmSimulationSetup = (settings) => {
    if (!pendingStartPoint) return;
    
    // Сбрасываем историю при новой настройке
    setSimulationHistory([]);
    setCompletedRunsInCurrentSession(0);
    setTotalRunsToComplete(0);
    setIsBatchRunning(false);
    setCurrentRunIndex(-1);
    setIsShowingHistory(false);
    
    setSimulationConfig({
      maxIterations: settings.maxIterations,
      numRuns: settings.numRuns,
      environmentParams: settings.environmentParams,
      environmentParamRanges: settings.environmentParamRanges,
      areaSize: settings.areaSize
    });
    
    setEnvironmentParams(settings.environmentParams);
    
    const newPoint = {
      ...pendingStartPoint,
      id: `start_${Date.now()}`
    };
    
    setElements(prev => [...prev, newPoint]);
    setStartPoint(newPoint);
    
    setPendingStartPoint(null);
    setShowSimulationSetup(false);
    setTool('select');
  };

  const getRandomEnvironmentParams = useCallback((ranges, baseParams) => {
    const result = {};
    
    if (!ranges) return baseParams || {};
    
    Object.keys(ranges).forEach(paramId => {
      const range = ranges[paramId];
      if (range.useRange) {
        // Генерируем случайное значение в интервале [min, max]
        let randomValue = range.min + Math.random() * (range.max - range.min);
        
        // Находим определение параметра для проверки типа
        const paramDef = selectedProcess?.process?.environmentParams?.find(p => p.id === paramId);
        if (paramDef?.type === 'integer') {
          randomValue = Math.round(randomValue);
        }
        
        result[paramId] = randomValue;
      } else {
        // Используем фиксированное значение
        result[paramId] = range.fixedValue;
      }
    });
    
    return result;
  }, [selectedProcess]);

  // Обработка клика для объекта
  const handleObjectClick = (scaledPos) => {
    if (!simulationArea) {
      alert('Сначала определите область моделирования');
      setTool('polygon');
      return;
    }
    
    if (!selectedProcess) {
      alert('Сначала выберите процесс моделирования');
      return;
    }
    
    if (!isPointInPolygon(scaledPos, simulationArea.points)) {
      alert('Объекты можно размещать только внутри области моделирования');
      return;
    }

    onObjectSelect(null);
    setPendingEventPos(null);
    
    // Полностью сбрасываем черновик перед новым добавлением
    setNewObjectDraft({
      name: '',
      objectTypeId: '',
      properties: {},
      isNewType: false,
      newTypeId: '',
      newTypeName: '',
      saveType: false
    });
    
    setObjectProperties({
      name: '',
      type: objectTypes[0]?.id || 'wood_object',
      resistance: 50,
      capacity: 0,
      customProps: {}
    });
    
    // Сохраняем позицию и открываем панель
    setPendingObjectPos(scaledPos);
    setShowProperties(true);
  };

  const confirmAddObject = () => {
    if (!pendingObjectPos) return;
    
    // Проверяем, выбран ли процесс
    if (!selectedProcess) {
      alert('Сначала выберите процесс моделирования');
      setShowProperties(false);
      setPendingObjectPos(null);
      return;
    }

    // Генерируем имя по умолчанию, если не указано
    const defaultName = `object_${elements.filter(e => e.type === 'object').length + 1}`;
    const objectName = newObjectDraft.name || defaultName;

    let objectTypeId = newObjectDraft.objectTypeId;
    let selectedObjectType = objectTypes.find(t => t.id === objectTypeId);
    let objectProperties = { ...newObjectDraft.properties };

    // Если создается новый тип
    if (newObjectDraft.isNewType) {
      if (!newObjectDraft.newTypeId || !newObjectDraft.newTypeName) {
        alert('Пожалуйста, заполните ID и название нового типа');
        return;
      }
      
      objectTypeId = newObjectDraft.newTypeId;
      
      // Сохраняем параметры в defaultProperties
      const defaultProperties = { ...objectProperties };
      
      const newObjectType = {
        id: objectTypeId,
        name: newObjectDraft.newTypeName,
        icon: '📦',
        defaultProperties: defaultProperties, // Сохраняем параметры
        props: defaultProperties, // Для совместимости с существующим кодом
        source: 'user',
        processId: selectedProcess.id,
        description: 'Пользовательский тип объекта',
        createdAt: new Date().toISOString()
      };

      // Сохраняем тип, если пользователь выбрал опцию
      if (newObjectDraft.saveType) {
        setObjectTypes(prev => {
          const exists = prev.some(t => t.id === objectTypeId);
          if (exists) {
            alert(`Тип с ID "${objectTypeId}" уже существует. Тип не будет сохранен.`);
            return prev;
          }
          alert(`Новый тип "${newObjectDraft.newTypeName}" сохранен в список типов объектов! Параметры: ${Object.keys(defaultProperties).join(', ')}`);
          return [...prev, newObjectType];
        });
      }
      selectedObjectType = newObjectType;
    }

    // Проверяем, выбран ли тип объекта (если не создается новый тип)
    if (!newObjectDraft.isNewType && !objectTypeId) {
      alert('Пожалуйста, выберите тип объекта');
      return;
    }

    const objectId = `object_${Date.now()}`;

    // Добавляем стандартные параметры для объекта
    const finalProperties = {
      ...objectProperties,
      currentState: 'normal'
    };
    
    // Добавляем устойчивость и вместимость, если они не заданы
    if (finalProperties.resistance === undefined) {
      finalProperties.resistance = 50;
    }
    if (finalProperties.capacity === undefined) {
      finalProperties.capacity = 0;
    }

    const newObject = {
      id: objectId,
      type: 'object',
      objectType: objectTypeId,
      x: pendingObjectPos.x,
      y: pendingObjectPos.y,
      radius: 6,
      fill: getObjectColor(objectTypeId),
      stroke: '#fff',
      strokeWidth: 1,
      draggable: true,
      label: objectName,
      properties: finalProperties
    };

    setElements(prev => [...prev, newObject]);
    
    // Сбрасываем все состояния для следующего добавления
    setPendingObjectPos(null);
    setShowProperties(false);
    
    // Сбрасываем черновик
    setNewObjectDraft({
      name: '',
      objectTypeId: '',
      properties: {},
      isNewType: false,
      newTypeId: '',
      newTypeName: '',
      saveType: false
    });
  };

  // Обработка клика для точки события
  const handleEventPointClick = (scaledPos) => {
    if (!simulationArea) {
      alert('Сначала определите область моделирования');
      setTool('polygon');
      return;
    }
    
    if (!selectedProcess) {
      alert('Сначала выберите процесс моделирования');
      return;
    }
    
    if (!isPointInPolygon(scaledPos, simulationArea.points)) {
      alert('Точки генерации событий можно размещать только внутри области моделирования');
      return;
    }
    
    // Сбрасываем другие режимы
    setPendingObjectPos(null);
    onObjectSelect(null);
    
    // Сохраняем позицию и открываем окно создания события
    setPendingEventPos(scaledPos);
    
    // Сбрасываем значения для нового события
    setEventName('');
    setEventRadius(6);
    setEventType(eventTypes[0]?.id || 'fire');
    setEventTriggerType('single');
    setEventCondition({
      triggerOnImpact: true,
      rules: []
    });
    
    setShowProperties(true);
  };

  // Получение всех доступных параметров для условий
  const getAvailableParams = () => {
    const params = [];
    
    // Параметры объектов
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
    
    // Параметры среды из процесса
    if (selectedProcess && selectedProcess.process.environmentParams) {
      selectedProcess.process.environmentParams.forEach(param => {
        params.push({
          id: `env.${param.id}`,
          name: `env.${param.name}`,
          category: 'environment'
        });
      });
    }
    
    return params;
  };

  // Функция добавления правила
  const addRule = () => {
    setEventCondition(prev => ({
      ...prev,
      rules: [
        ...prev.rules,
        {
          param: '',
          operator: '>',
          value: '',
          combinator: prev.rules.length > 0 ? 'AND' : ''
        }
      ]
    }));
  };

  // Функция обновления правила
  const updateRule = (index, field, value) => {
    setEventCondition(prev => {
      const newRules = [...prev.rules];
      newRules[index][field] = value;
      return { ...prev, rules: newRules };
    });
  };

  // Функция удаления правила
  const removeRule = (index) => {
    setEventCondition(prev => ({
      ...prev,
      rules: prev.rules.filter((_, i) => i !== index)
    }));
  };

  // Функция построения строки условия
  const buildConditionString = () => {
    const { triggerOnImpact, rules } = eventCondition;
    const parts = [];
    
    if (triggerOnImpact) {
      parts.push('попадание в зону воздействия OR');
    }
    
    rules.forEach((rule, index) => {
      if (!rule.param || !rule.value) return;
      
      // Находим имя параметра для отображения
      const param = getAvailableParams().find(p => p.id === rule.param);
      const paramName = param ? param.name : rule.param;
      
      let ruleStr = `${paramName} ${rule.operator} ${rule.value}`;
      
      if (index > 0 && rule.combinator) {
        ruleStr = `${rule.combinator} ${ruleStr}`;
      }
      
      parts.push(ruleStr);
    });
    
    if (parts.length === 0) return 'Нет условий (событие будет активироваться всегда)';
    
    return parts.join(' ');
  };

  // Подтверждение создания события
  const confirmAddEvent = () => {
    if (!pendingEventPos) return;
    
    const eventId = `event_${Date.now()}`;
    
    const newEventPoint = {
      id: eventId,
      type: 'eventPoint',
      eventType: eventType,
      x: pendingEventPos.x,
      y: pendingEventPos.y,
      radius: eventRadius,
      fill: getEventColor(eventType),
      stroke: '#fff',
      strokeWidth: 1,
      draggable: true,
      label: eventName || `Событие ${elements.filter(e => e.type === 'eventPoint').length + 1}`,
      condition: eventCondition,
      triggerType: eventTriggerType,
      hasTriggered: false, // Флаг для отслеживания, сработало ли уже событие
      properties: {}
    };
    
    setElements(prev => [...prev, newEventPoint]);
    
    // Сбрасываем состояния
    setPendingEventPos(null);
    setShowProperties(false);
    setEventName('');
    setEventRadius(6);
    setEventTriggerType('single');
    setEventCondition({
      triggerOnImpact: true,
      rules: []
    });
  };

  // Обработка клика для выделения
  const handleSelectClick = (scaledPos) => {
    const clickedElement = elements.find((el) => {
      if (el.type === 'object' || el.type === 'startPoint' || el.type === 'eventPoint') {
        if (el.x === undefined || el.y === undefined) return false;

        const elementRadius = el.radius || 8;
        const distance = Math.sqrt(
          Math.pow(scaledPos.x - el.x, 2) + 
          Math.pow(scaledPos.y - el.y, 2)
        );
        return distance < elementRadius + 5;
      }
      return false;
    });
    
    if (clickedElement) {
      onObjectSelect(clickedElement);
      
      if (clickedElement.type === 'object') {
        // Полностью обновляем objectProperties с данными выбранного объекта
        setObjectProperties({
          name: clickedElement.label || '',
          type: clickedElement.objectType,
          resistance: clickedElement.properties?.resistance !== undefined ? clickedElement.properties.resistance : 50,
          capacity: clickedElement.properties?.capacity !== undefined ? clickedElement.properties.capacity : 0,
          customProps: clickedElement.properties?.custom || {},
          allProperties: clickedElement.properties || {}
        });
        setShowProperties(true);
        
      } else if (clickedElement.type === 'eventPoint') {
        setEventPointProperties({
          name: clickedElement.label || '',
          eventType: clickedElement.eventType,
          threshold: clickedElement.properties?.threshold !== undefined ? clickedElement.properties.threshold : 50,
          customProps: clickedElement.properties?.custom || {}
        });
        setShowProperties(true);
      }
    }
  };

  // Получение цвета объекта
  const getObjectColor = (type) => {
    const colors = {
      building: '#3b82f6',
      resource: '#10b981',
      hazard: '#f59e0b',
      vehicle: '#f59e0b',
      person: '#8b5cf6',
      custom: '#64748b'
    };
    return '#10b981';
  };

  // Получение цвета события
  const getEventColor = (eventType) => {
    const colors = {
      fire: '#f59e0b',
      flood: '#3b82f6',
      explosion: '#f59e0b',
      chemical: '#10b981',
      biological: '#8b5cf6',
      radiation: '#ec4899'
    };
    return '#3b82f6';
  };

  // Запуск симуляции
  const startSimulation = useCallback((isBatch = false) => {
    if (!selectedProcess || !simulationArea || !startPoint) {
      alert('Для запуска моделирования необходимо:\n- Выбрать процесс\n- Определить область моделирования\n- Установить точку начала');
      return;
    }

    // Начинаем новую сессию логирования
    if (!isBatch) {
      //eventLogger.clear();
      //eventLogger.startSeries();
    }

    // Начинаем новую сессию логирования
    const runNumber = isBatch ? completedRunsRef.current + 1 : 1;
    eventLogger.startRun(runNumber);

    // Выходим из режима просмотра истории
    setIsShowingHistory(false);
    setIsBatchRunning(isBatch);
    
    // Если это первый запуск в серии - сбрасываем историю
    if (!isBatch) {
      eventLogger.startSeries();
      completedRunsRef.current = 0;
      setCompletedRunsInCurrentSession(0);
      setSimulationHistory([]);
      setCurrentRunIndex(-1);
      setTotalRunsToComplete(simulationConfig.numRuns);
    }
    completionFiredRef.current = false;

    // Сбрасываем состояния для нового запуска
    setRealTime(0);
    setSimulationStartTime(null);
    setSimulationTime(0);
    setSimulationIterations(0);

    const processData = selectedProcess.process || selectedProcess;
    const defaultPropertiesMap = {};

    // Создаем карту дефолтных свойств для каждого типа объекта
    if (processData.objectTypes) {
      processData.objectTypes.forEach(objType => {
        defaultPropertiesMap[objType.id] = objType.defaultProperties || {};
      });
    }
  
    // Обновляем элементы, сбрасывая их свойства
    const resetElements = elements.map(el => {
      if (el.type === 'object' && defaultPropertiesMap[el.objectType]) {
        // Сбрасываем свойства к дефолтным, но сохраняем позицию и ID
        const defaultProps = { ...defaultPropertiesMap[el.objectType] };
        return {
          ...el,
          properties: {
            ...defaultProps,
            currentState: 'normal'
          }
        };
      }
      return el;
    });
    
    setElements(resetElements);
    elementsRef.current = resetElements;

    const actualProcess = selectedProcess.process || selectedProcess;

    // КАЖДЫЙ РАЗ ГЕНЕРИРУЕМ НОВЫЕ СЛУЧАЙНЫЕ ПАРАМЕТРЫ
    const currentRunParams = getRandomEnvironmentParams(
      simulationConfig.environmentParamRanges,
      simulationConfig.environmentParams
    );

    console.log('Новые параметры для запуска:', currentRunParams);

    const currentConfig = {
      ...simulationConfig,
      environmentParams: currentRunParams
    };

    const initialState = initializeSimulation(
      actualProcess,
      simulationArea,
      resetElements,
      currentConfig,
      startPoint,
      isPointInPolygon
    );

    completionFiredRef.current = false; // сброс флага для нового запуска
    currentRunParamsRef.current = currentRunParams; // сохраняем для saveRun
    setCurrentRunParams(currentRunParams);

    if (!initialState) {
      alert('Не удалось инициализировать симуляцию');
      return;
    }

    setSimulationState(initialState);
    setAffectedObjects(initialState.affectedHistory || new Set());
    setTriggeredEvents(initialState.triggeredEvents || new Set());
    
    if (onSimulationToggle) {
      onSimulationToggle(true);
    }
    
  }, [selectedProcess, simulationArea, startPoint, elements, simulationConfig, getRandomEnvironmentParams, onSimulationToggle, isPointInPolygon, isBatchRunning, completedRunsInCurrentSession]);

  // Управление интервалом симуляции
  useEffect(() => {
    if (!isSimulationRunning) {
      setSimulationStartTime(null);
      return;
    }

    if (!simulationStartTime) {
      setSimulationStartTime(Date.now());
    }

    const interval = setInterval(() => {
      const currentState = simulationStateRef.current;
      const actualProcess = selectedProcess?.process || selectedProcess;

      if (!currentState || !actualProcess) return;

      const stepResult = stepSimulation(
        currentState,
        actualProcess,
        simulationConfigRef.current,
        elementsRef.current,
        simulationArea,
        isPointInPolygon
      );

      if (!stepResult) return;

      // Обновляем рефы и стейт
      simulationStateRef.current = stepResult.newState;
      setSimulationState(stepResult.newState);
      setAffectedObjects(stepResult.affectedObjects);
      setTriggeredEvents(stepResult.triggeredEvents);
      if (stepResult.updatedElements) {
        setElements(stepResult.updatedElements);
      }

      simulationIterationsRef.current += 1;
      setSimulationIterations(simulationIterationsRef.current);

      // Логируем события из процесса (изменения объектов, срабатывания и т.п.)
      const processEvents = stepResult.processEvents || [];
      processEvents.forEach(ev => {
        const relatedEl = elementsRef.current.find(e => e.id === ev.objectId);
        eventLogger.systemEvent({
          eventName: ev.details || ev.type,
          iteration: stepResult.newState.iteration,
          attributes: {
            objectId:         ev.objectId,
            objectType:       ev.objectType,
            position:         ev.position,
            objectLabel:      relatedEl?.label || relatedEl?.objectType || ev.objectId,
            objectProperties: relatedEl?.properties || {},
            eventDetails:     ev.details,
          }
        });
      });

      // Проверка завершения — один раз, через реф-флаг
      if (
        !completionFiredRef.current &&
        isSimulationComplete(stepResult.newState, actualProcess, simulationConfigRef.current.maxIterations)
      ) {
        completionFiredRef.current = true;
        handleCompleteSimulation(stepResult.newState); // передаём финальный стейт явно
      }
    }, 100);

    return () => clearInterval(interval);
  // simulationState намеренно убран из зависимостей!
  }, [isSimulationRunning, selectedProcess, simulationArea, isPointInPolygon, simulationStartTime]);

  const handlePauseSimulation = () => {
    if (onSimulationToggle) {
      onSimulationToggle(false);
    }
  };

  const handleStopSimulation = useCallback(() => {
    if (onSimulationToggle) {
      onSimulationToggle(false);
    }
    
    // Сохраняем текущее состояние в историю только если есть активный запуск
    if (simulationState && isSimulationRunning) {
      const newCount = completedRunsInCurrentSession + 1;
      saveCurrentRunToHistory(newCount);
      setCompletedRunsInCurrentSession(newCount);
    }
    
    setSimulationStartTime(null);
    setIsBatchRunning(false);
    setTotalRunsToComplete(0);
    
    // Показываем историю если есть сохраненные запуски
    if (simulationHistory.length > 0) {
      setIsShowingHistory(true);
      setCurrentRunIndex(simulationHistory.length - 1);
    }
  }, [onSimulationToggle, simulationState, isSimulationRunning, saveCurrentRunToHistory, completedRunsInCurrentSession, simulationHistory]);

  const loadRunFromHistory = useCallback((index) => {
    const run = simulationHistory[index];
    if (!run) return;
    
    setSimulationState(run.simulationState);
    setAffectedObjects(new Set(run.affectedObjects));
    setTriggeredEvents(new Set(run.triggeredEvents));
    setSimulationIterations(run.iterations);
    setRealTime(run.realTime);
    setCurrentRunIndex(index);
    setIsShowingHistory(true);
    
    if (onSimulationToggle) onSimulationToggle(false); // Останавливаем симуляцию если она была запущена
  }, [simulationHistory, onSimulationToggle]);

  // Функция завершения симуляции
  const handleCompleteSimulation = useCallback((finalState) => {
    // Логируем завершение
    eventLogger.endRun({
      iteration: finalState.iteration,
      hasFire: finalState.grid.some(row => row.some(cell => cell > 0)),
      environmentParams: currentRunParamsRef.current,
    });

    // completedRunsRef — реф, всегда актуален
    completedRunsRef.current += 1;
    const newCompletedCount = completedRunsRef.current;
    setCompletedRunsInCurrentSession(newCompletedCount);

    // Сохраняем запуск — финальный стейт из параметра, не из useState
    const runData = {
      id: Date.now(),
      runNumber: newCompletedCount,
      timestamp: new Date().toISOString(),
      simulationState: JSON.parse(JSON.stringify(finalState)),
      affectedObjects: Array.from(affectedObjectsRef.current),
      triggeredEvents: Array.from(triggeredEventsRef.current),
      elements: JSON.parse(JSON.stringify(elementsRef.current)),
      iterations: simulationIterationsRef.current,
      realTime: realTimeRef.current,
      environmentParams: { ...currentRunParamsRef.current }
    };
    setSimulationHistory(prev => [...prev, runData]);

    if (onSimulationComplete) {
      onSimulationComplete({
        runNumber: newCompletedCount,
        totalRuns: simulationConfigRef.current.numRuns,
        iterations: simulationIterationsRef.current,
        time: realTimeRef.current,
      });
    }

    if (onSimulationToggle) onSimulationToggle(false);
    setSimulationStartTime(null);

    const runsToDo = simulationConfigRef.current.numRuns;

    if (newCompletedCount < runsToDo) {
      alert(`Запуск ${newCompletedCount} из ${runsToDo} завершён!\nЗапускаем следующий...`);
      setTimeout(() => startSimulation(true), 800);
    } else {
      if (runsToDo > 1) {
        alert(`Все ${runsToDo} запусков завершены!`);
      }
      completedRunsRef.current = 0;
      setCompletedRunsInCurrentSession(0);
      setIsShowingHistory(true);
      setCurrentRunIndex(newCompletedCount - 1);
      setIsBatchRunning(false);
    }
  }, [onSimulationComplete, onSimulationToggle, startSimulation]);

  // Управление масштабом
  const handleZoomIn = () => {
    setScale(prev => Math.min(prev * 1.2, 5));
  };

  const handleZoomOut = () => {
    setScale(prev => Math.max(prev * 0.8, 0.1));
  };

  const handleFitToScreen = () => {
    if (image) {
      fitImageToContainer();
    }
  };

  // Удаление элемента
  const deleteElement = (element) => {
    if (!element) return;
  
    if (element.type === 'simulationArea') {
      if (!window.confirm('Удалить область моделирования и все элементы внутри?')) return;
  
      setSimulationArea(null);
      setStartPoint(null);
      setElements([]);
      onObjectSelect(null);
      return;
    }
  
    if (element.type === 'startPoint') {
      setStartPoint(null);
    }
  
    setElements(prev => prev.filter(el => el !== element));
    onObjectSelect(null);
    setShowProperties(false);
  };

  // Компонент подсказки
  const Tooltip = ({ text, children }) => {
    const [show, setShow] = useState(false);
    
    return (
      <div className="tooltip-container" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
        {children}
        {show && <div className="tooltip">{text}</div>}
      </div>
    );
  };

  // Обновление свойств объекта
const updateObjectProperties = () => {
  if (!selectedObject) return;
  
  const updatedElements = elements.map(el => {
    if (el.id === selectedObject.id) {
      if (selectedObject.type === 'object') {
        return {
          ...el,
          label: objectProperties.name,
          radius: el.radius,
          properties: {
            ...el.properties,
            resistance: objectProperties.resistance,
            capacity: objectProperties.capacity,
            custom: { ...objectProperties.customProps }
          }
        };
      } else if (selectedObject.type === 'eventPoint') {
        return {
          ...el,
          label: eventPointProperties.name,
          radius: el.radius,
          properties: {
            ...el.properties,
            threshold: eventPointProperties.threshold,
            custom: { ...eventPointProperties.customProps }
          }
        };
      }
      return el;
    }
    return el;
  });
  
  setElements(updatedElements);
  
  // Обновляем selectedObject через пропс
  const updatedSelected = updatedElements.find(el => el.id === selectedObject.id);
  onObjectSelect(updatedSelected);
  
};

  // Форматирование времени
  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = (seconds % 60).toFixed(1);
    
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const lastValidPosRef = useRef({});
  // Функция для ограничения перемещения внутри полигона
  const limitDragToPolygon = (pos, id, radius = 0) => {
    if (!simulationArea || !stageRef.current) return pos;
  
    const stage = stageRef.current;
    const transform = stage.getAbsoluteTransform().copy();
    transform.invert();
  
    const worldPos = transform.point(pos);
  
    const testPoints = [
      { x: worldPos.x + radius, y: worldPos.y },
      { x: worldPos.x - radius, y: worldPos.y },
      { x: worldPos.x, y: worldPos.y + radius },
      { x: worldPos.x, y: worldPos.y - radius }
    ];
  
    const inside = testPoints.every(p =>
      isPointInPolygon(p, simulationArea.points)
    );
  
    if (inside) {
      lastValidPosRef.current[id] = pos;
      return pos;
    }

    return lastValidPosRef.current[id] || pos;
  };
    
  const updateElementRadius = (id, newRadius) => {
    setElements(prev =>
      prev.map(el => {
        if (el.id !== id) return el;
  
        const fits = isCircleInsidePolygon(
          { x: el.x, y: el.y },
          newRadius,
          simulationArea?.points
        );
  
        if (!fits) return el;
  
        return { ...el, radius: newRadius };
      })
    );
  
    // если это startPoint — обновляем отдельно
    if (startPoint?.id === id) {
      setStartPoint(prev =>
        prev ? { ...prev, radius: newRadius } : prev
      );
    }
  };  

  const isCircleInsidePolygon = (center, radius, polygonPoints) => {
    if (!polygonPoints) return false;
  
    const testPoints = [
      { x: center.x + radius, y: center.y },
      { x: center.x - radius, y: center.y },
      { x: center.x, y: center.y + radius },
      { x: center.x, y: center.y - radius }
    ];
  
    return testPoints.every(p => isPointInPolygon(p, polygonPoints));
  };  

  // Типы объектов
  const [objectTypes, setObjectTypes] = useState([]);

  const [pendingObjectPos, setPendingObjectPos] = useState(null);

  const [newObjectDraft, setNewObjectDraft] = useState({
    name: '',
    objectTypeId: '',
    properties: {},
    isNewType: false,
    newTypeId: '',
    newTypeName: '',
    saveType: false
  });

  // Типы событий
  const [eventTypes, setEventTypes] = useState([
    { id: 'fire', name: 'Пожар', icon: '🔥', objectTypes: [] },
    { id: 'flood', name: 'Наводнение', icon: '🌊', objectTypes: [] },
  ]);  

  // Сохранение проекта
  const handleSaveProject = () => {
    saveProject({
      elements,
      simulationArea,
      startPoint,
      simulationConfig,
      selectedProcess,
      imageDataUrl: null,
    }, 'my_project');
    alert('Проект сохранен!');
  };

  const exportCurrentViewAsImage = () => {
    if (!stageRef.current) {
      alert('Нет данных для экспорта');
      return;
    }

    try {
      // Получаем данные текущего этапа
      const stage = stageRef.current;
      const dataURL = stage.toDataURL({
        pixelRatio: 2, // Повышенное качество
        mimeType: 'image/png'
      });
      
      // Создаем ссылку для скачивания
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
      const runNumber = currentRunIndex >= 0 ? simulationHistory[currentRunIndex]?.runNumber : 'current';
      link.download = `simulation_state_run_${runNumber}_${timestamp}.png`;
      link.href = dataURL;
      link.click();
    } catch (error) {
      console.error('Ошибка экспорта изображения:', error);
      alert('Не удалось экспортировать изображение');
    }
  };

  // Загрузка проекта
  const handleLoadProject = async () => {
    try {
      const data = await openProjectFile();

      // Восстанавливаем карту
      setElements(data.elements);
      setSimulationArea(data.simulationArea);
      setStartPoint(data.startPoint);
      setSimulationConfig(data.simulationConfig);

      // Переподвязываем процесс (стандартные — автоматически, пользовательские — с предупреждением)
      const relinked = relinkProcess(data.process, availableProcesses);
      if (relinked?._functionsLost) {
        alert(`Процесс "${relinked.name}" загружен без логики распространения — загрузите JS-файл процесса заново.`);
      }
      setSelectedProcess(relinked);

      alert('Проект загружен!');
    } catch (err) {
      alert('Ошибка загрузки проекта: ' + err.message);
    }
  };

  // Добавление нового типа объекта
  const handleAddObjectType = () => {
    const newType = prompt('Введите название нового типа объекта:');
    if (newType) {
      const newId = newType.toLowerCase().replace(/\s+/g, '_');
      setObjectProperties(prev => ({
        ...prev,
        type: newId
      }));
      alert(`Тип "${newType}" добавлен!`);
    }
  };

  // Вспомогательная функция для проверки интерфейса процесса
  const validateProcessClass = (processData) => {
    if (!processData) return false;
    if (typeof processData.id !== 'string' || !processData.id) return false;
    if (typeof processData.name !== 'string' || !processData.name) return false;
    if (!Array.isArray(processData.objectTypes)) return false;

    for (let objType of processData.objectTypes) {
      if (typeof objType.id !== 'string' || typeof objType.name !== 'string') return false;
    }

    return true;
  };

  // Функция добавления процесса
  const handleAddEventType = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
  
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const processData = JSON.parse(event.target.result);
  
          // Проверка соответствия интерфейсу
          if (!validateProcessClass(processData)) {
            alert('Файл не соответствует формату процесса!');
            return;
          }
  
          // Проверяем, нет ли уже такого процесса
          if (eventTypes.find(p => p.id === processData.id)) {
            alert('Процесс с таким ID уже существует!');
            return;
          }
  
          // Добавляем процесс в состояние
          setEventTypes(prev => [...prev, {
            id: processData.id,
            name: processData.name,
            icon: processData.icon || '⚡', // дефолтная иконка
            objectTypes: processData.objectTypes // для синхронизации типов объектов
          }]);
  
          alert(`Процесс "${processData.name}" успешно добавлен!`);
        } catch (err) {
          alert('Ошибка при загрузке процесса: ' + err.message);
        }
      };
      reader.readAsText(file);
    };
  
    // Открываем диалог выбора файла
    input.click();
  };
  


  // Рендер элементов управления симуляцией
  const renderSimulationControls = () => {
    return (
      <div className="sim-controls-left">
        {!isSimulationRunning ? (
          <button 
            className="sim-control-btn start"
            onClick={() => {
              // Сбрасываем историю перед новым запуском
              setSimulationHistory([]);
              setCompletedRunsInCurrentSession(0);
              setCurrentRunIndex(-1);
              setIsShowingHistory(false);
              // Запускаем в пакетном режиме если numRuns > 1
              const isBatchMode = simulationConfig.numRuns > 1;
              startSimulation(isBatchMode);
            }}
            disabled={!simulationArea || !startPoint || !selectedProcess || isSimulationRunning}
            title="Запустить моделирование"
          >
            ▶ Запуск
          </button>
        ) : (
          <button 
            className="sim-control-btn pause"
            onClick={() => onSimulationToggle && onSimulationToggle(false)}
            title="Приостановить моделирование"
          >
            ⏸ Пауза
          </button>
        )}
        <button 
          className="sim-control-btn stop"
          onClick={handleStopSimulation}
          disabled={!isSimulationRunning}
          title="Завершить моделирование"
        >
          ⏹ Стоп
        </button>
      </div>
    );
  };

  const isCreatingObject = !selectedObject && pendingObjectPos;

  return (
    <div className="map-canvas-container" ref={containerRef}>
      <div className="map-stage-wrapper">
        <div className="stage-container" ref={stageContainerRef}>
          {/* Верхняя панель инструментов */}
          <div className="top-toolbar">
          <div className="left-controls">
            <button onClick={handleZoomIn} className="toolbar-btn" title="Увеличить">
              +
            </button>
            <button onClick={handleZoomOut} className="toolbar-btn" title="Уменьшить">
              -
            </button>
            <button 
              onClick={handleFitToScreen} 
              className="toolbar-btn" 
              title="Вписать в экран"
            >
              🔍
            </button>
            <div className="toolbar-divider" />
            
            {/* Кнопка загрузки изображения в верхней панели */}
            <button 
              className="file-upload-btn"
              onClick={handleImageUploadFromButton}
              title="Загрузить изображение карты"
            >
              📷
            </button>

            <button 
              className={`toolbar-btn ${tool === 'select' ? 'active' : ''}`}
              onClick={() => setTool('select')}
              title="Режим выделения"
            >
              👆
            </button>
            
            {/* Выпадающий список для выбора процесса */}
            <div className="process-selector">
              <button 
                className={`process-selector-btn ${selectedProcess ? 'active' : ''}`}
                onClick={() => document.querySelector('.process-dropdown').classList.toggle('show')}
              >
                <span className="process-icon">{selectedProcess?.icon}</span>
                <span className="process-name">
                  {selectedProcess ? selectedProcess.name : 'Выберите процесс'}
                </span>
                <span className="dropdown-arrow">▼</span>
              </button>
              
              <div className="process-dropdown">
                {availableProcesses.map(process => (
                  <div key={process.id} className="process-dropdown-item">
                    <button
                      className={`process-option ${selectedProcess?.id === process.id ? 'selected' : ''}`}
                      onClick={() => {
                        handleProcessSelect(process);
                        document.querySelector('.process-dropdown').classList.remove('show');
                      }}
                    >
                      <span className="process-icon">{process.icon}</span>
                      <span className="process-name">{process.name}</span>
                      {process.source === 'user' && (
                        <span className="process-badge" title="Пользовательский процесс">📥</span>
                      )}
                    </button>
                    <button
                      className="view-code-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleShowProcessCode(process);
                        document.querySelector('.process-dropdown').classList.remove('show');
                      }}
                      title="Просмотреть код процесса"
                    >
                      📄
                    </button>
                  </div>
                ))}
                
                <div className="process-dropdown-divider" />
                
                <button
                  className="process-dropdown-item add-process-btn"
                  onClick={() => {
                    handleAddCustomProcess();
                    document.querySelector('.process-dropdown').classList.remove('show');
                  }}
                >
                  <span className="process-icon">➕</span>
                  <span className="process-name">Добавить свой процесс</span>
                </button>
              </div>
            </div>
          </div>
            
          </div>

          {/* Панель управления полигоном - показывается только во время рисования */}
          {tool === 'polygon' && polygonPoints.length > 0 && (
            <div className="polygon-controls-overlay">
              <div className="polygon-controls-panel">
                <button onClick={cancelPolygon} className="polygon-control-btn cancel">
                  ✖ Отменить полигон
                </button>
                <button 
                  onClick={completePolygon} 
                  className="polygon-control-btn complete"
                  disabled={polygonPoints.length < 3}
                >
                  ✅ Завершить полигон ({polygonPoints.length}/3)
                </button>
              </div>
            </div>
          )}

          {/* Информационная панель */}
          <div className="info-panel">
            <div className="info-stats">
              <div className="stat-item">
                <span className="stat-label">Область:</span>
                <span className={`stat-value ${simulationArea ? 'success' : 'danger'}`}>
                  {simulationArea ? '✓' : '✗'}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Начало:</span>
                <span className={`stat-value ${startPoint ? 'success' : 'danger'}`}>
                  {startPoint ? '✓' : '✗'}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Объекты:</span>
                <span className="stat-value">
                  {elements.filter(e => e.type === 'object').length}
                </span>
              </div>
              <div className="stat-item">
                <span className="stat-label">События:</span>
                <span className="stat-value">
                  {elements.filter(e => e.type === 'eventPoint').length}
                </span>
              </div>
              <div className="stat-item" style={{ textAlign: 'right', marginLeft: 'auto' }}>
                <span className="stat-label">Макс. итераций:</span>
                <span className="stat-value">
                  {simulationConfig.maxIterations ? simulationConfig.maxIterations : '-'}
                </span>
              </div>
              <div className="stat-item" style={{ textAlign: 'right'}}>
                <span className="stat-label">Кол-во запусков:</span>
                <span className="stat-value">
                  {simulationConfig.numRuns ? simulationConfig.numRuns : '-'}
                </span>
              </div>
              {isSimulationRunning && (
                <>
                  <div className="stat-item">
                    <span className="stat-label">Время:</span>
                    <span className="stat-value time">
                      {formatTime(realTime)}
                    </span>
                  </div>
                  <div className="stat-item">
                    <span className="stat-label">Итерации:</span>
                    <span className="stat-value iterations">
                      {simulationIterations}/{simulationConfig.maxIterations}
                    </span>
                  </div>
                  {/* Отображение параметров среды */}
                  {Object.keys(currentRunParams).length > 0 && Object.entries(currentRunParams).map(([key, value]) => (
                    <div className="stat-item" key={key}>
                      <span className="stat-label">{key}:</span>
                      <span className="stat-value">{value.toFixed?.(2)}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            onClick={handleStageClick}
            scaleX={scale}
            scaleY={scale}
            x={position.x}
            y={position.y}
            draggable={tool === 'select' && !polygonPoints.length}
          >
            <Layer>
              {/* Фоновая карта */}
              {image && (
                <Image
                  image={image}
                  x={0}
                  y={0}
                  width={image.width}
                  height={image.height}
                />
              )}

              {/* Отображение зоны воздействия процесса */}
              {(isSimulationRunning || isShowingHistory) && simulationState && selectedProcess && (
                <>
                  {simulationState.grid.map((row, y) => 
                    row.map((cell, x) => {
                      const wetLevel = simulationState.wet?.[y]?.[x] || 0;
                      const cellTemp = simulationState.temperature?.[y]?.[x] || 20;

                      // Показываем ячейку если она горит ИЛИ намочена спринклером
                      const shouldShow = cell > 0 || wetLevel > 30 || cellTemp > 60;
                      if (!shouldShow) return null;

                      // Вычисляем реальные координаты клетки
                      const cellX = simulationState.minX + x;
                      const cellY = simulationState.minY + y;
                      
                      // Проверяем, находится ли клетка внутри многоугольника
                      const isInsidePolygon = isPointInPolygon(
                        { x: cellX, y: cellY }, 
                        simulationArea.points
                      );
                      
                      // Показываем только клетки внутри области моделирования
                      if (!isInsidePolygon) return null;
                      
                      // Получаем реальный объект процесса
                      const actualProcess = selectedProcess.process || selectedProcess;
                      let color = 'rgba(255, 0, 0, 0.5)';
                      if (actualProcess && typeof actualProcess.getCellColor === 'function') {
                        // Передаём все три аргумента: значение ячейки, температуру, намокание
                        color = actualProcess.getCellColor(cell, cellTemp, wetLevel);
                      }
                      return (
                        <Rect
                          key={`cell-${x}-${y}`}
                          x={cellX}
                          y={cellY}
                          width={1}
                          height={1}
                          fill={color}
                        />
                      );
                    })
                  )}
                </>
              )}

              {/* Существующие элементы */}
              {elements.map((element, index) => {
                const isSelected = element === selectedObject;
                
                switch (element.type) {
                  case 'simulationArea':
                    return (
                      <Line
                        key={index}
                        points={element.points}
                        fill={element.fill}
                        stroke={element.stroke}
                        strokeWidth={element.strokeWidth}
                        closed={element.closed}
                      />
                    );
                  // Для startPoint:
                  case 'startPoint':
                    return (
                      <Group key={index}>
                        <Circle
                          x={element.x}
                          y={element.y}
                          radius={element.radius}
                          fill={element.fill}
                          stroke={element.stroke}
                          strokeWidth={element.strokeWidth}
                          draggable={element.draggable}
                          dragBoundFunc={(pos) =>
                            limitDragToPolygon(pos, element.id, element.radius)
                          }                          
                          onDragEnd={(e) => {
                            const newX = e.target.x();
                            const newY = e.target.y();
                            
                            // Обновляем позицию в состоянии
                            const updated = [...elements];
                            updated[index] = {
                              ...updated[index],
                              x: newX,
                              y: newY
                            };
                            setElements(updated);
                            setStartPoint(updated[index]);
                          }}
                          onClick={(e) => {
                            e.cancelBubble = true;
                            if (window.confirm('Удалить точку начала моделирования?')) {
                              deleteElement(element);
                            }
                          }}
                        />
                        <Text
                          text={element.label}
                          x={element.x + 15}
                          y={element.y - 25}
                          fontSize={12}
                          fill="white"
                          padding={5}
                          background="#ef4444"
                          backgroundCornerRadius={3}
                        />
                      </Group>
                    );

                  // Для объекта:
                  case 'object':
                    // Определяем цвет в зависимости от состояния
                    let objectFill = element.fill;
                    let objectStroke = element.stroke;
                    
                    if (isSimulationRunning) {
                      if (affectedObjects.has(element.id)) {
                        objectFill = '#8b0000'; // Темно-красный
                        objectStroke = '#ff0000';
                      } else if (element.properties?.resistance < 30) {
                        objectFill = '#ff6b6b'; // Светло-красный (под угрозой)
                      }
                    }
                    
                    if (isSelected) {
                      objectFill = '#ffd700';
                      objectStroke = '#ff9900';
                    }

                    return (
                      <Group key={index}>
                        <Circle
                          x={element.x}
                          y={element.y}
                          radius={element.radius}
                          fill={objectFill}
                          stroke={objectStroke}
                          strokeWidth={isSelected ? 3 : element.strokeWidth}
                          draggable={!isSimulationRunning && element.draggable}
                          dragBoundFunc={(pos) =>
                            limitDragToPolygon(pos, element.id, element.radius)
                          }                          
                          onDragEnd={(e) => {
                            if (!isSimulationRunning) {
                              const updated = [...elements];
                              updated[index] = {
                                ...updated[index],
                                x: e.target.x(),
                                y: e.target.y()
                              };
                              setElements(updated);
                            }
                          }}
                          onClick={(e) => {
                            if (!isSimulationRunning) {
                              e.cancelBubble = true;
                              onObjectSelect(element);
                              setShowProperties(true);
                            }
                          }}
                        />
                        <Text
                          text={element.label}
                          x={element.x - 30}
                          y={element.y - 25}
                          fontSize={11}
                          fill="white"
                          padding={4}
                          background={isSelected ? '#ff9900' : element.fill}
                          width={60}
                          align="center"
                        />
                      </Group>
                    );

                  // Для eventPoint:
                  case 'eventPoint':
                    // Определяем цвет в зависимости от состояния
                    let eventFill = element.fill;
                    let eventStroke = element.stroke;
                    let eventStrokeWidth = element.strokeWidth;
                    
                    if (isSimulationRunning) {
                      if (triggeredEvents.has(element.id)) {
                        eventStroke = '#ffd700'; // Желтая обводка
                        eventStrokeWidth = 2;
                      }

                      if (affectedObjects.has(element.id)) {
                        eventFill = '#4b0082';
                      }
                    }

                    return (
                      <Group key={index}>
                        <Circle
                          x={element.x}
                          y={element.y}
                          radius={element.radius}
                          fill={eventFill}
                          stroke={triggeredEvents.has(element.id) ? '#ffd700' : element.stroke}
                          strokeWidth={triggeredEvents.has(element.id) ? 2 : element.strokeWidth}
                          draggable={!isSimulationRunning && element.draggable}
                          dragBoundFunc={(pos) =>
                            !isSimulationRunning ? limitDragToPolygon(pos, element.id, element.radius) : pos
                          }                          
                          onDragEnd={(e) => {
                            if (!isSimulationRunning) {
                              const updated = [...elements];
                              updated[index] = {
                                ...updated[index],
                                x: e.target.x(),
                                y: e.target.y()
                              };
                              setElements(updated);
                            }
                          }}
                          onClick={(e) => {
                            if (!isSimulationRunning) {
                              e.cancelBubble = true;
                              onObjectSelect(element);
                              setShowProperties(true);
                            }
                          }}
                        />
                        <Text
                          text={element.label}
                          x={element.x - 40}
                          y={element.y + 10}
                          fontSize={11}
                          fill="white"
                          padding={4}
                          background={isSelected ? '#ff9900' : element.fill}
                          width={80}
                          align="center"
                        />
                      </Group>
                    );
                  default:
                    return null;
                }
              })}

              {/* Рисуемый полигон */}
              {polygonPoints.length > 0 && (
                <>
                  {/* Линии между точками полигона */}
                  <Line
                    points={polygonPoints.flatMap(p => [p.x, p.y])}
                    stroke="#3b82f6"
                    strokeWidth={2}
                  />
                  
                  {/* Точки полигона */}
                  {polygonPoints.map((point, index) => (
                    <Group key={`poly-point-${index}`}>
                      <Circle
                        x={point.x}
                        y={point.y}
                        radius={index === 0 ? 6 : 4}
                        fill={index === 0 ? '#10b981' : '#3b82f6'}
                        stroke="white"
                        strokeWidth={index === 0 ? 2 : 1}
                      />
                      <Text
                        x={point.x + (index === 0 ? 10 : 8)}
                        y={point.y - (index === 0 ? 10 : 8)}
                        text={index === 0 ? '¹' : (index + 1).toString()}
                        fontSize={index === 0 ? 12 : 10}
                        fill="white"
                        padding={2}
                        background={index === 0 ? '#10b981' : '#3b82f6'}
                      />
                    </Group>
                  ))}
                  
                  {/* Временная линия от последней точки к курсору */}
                  {tempLine && (
                    <Line
                      points={tempLine.points}
                      stroke={tempLine.stroke}
                      strokeWidth={tempLine.strokeWidth}
                      dash={tempLine.dash}
                    />
                  )}
                </>
              )}
            </Layer>
          </Stage>
        </div>

        {/* Панель управления симуляцией */}
        <div className="simulation-controls">
          {renderSimulationControls()}
          
          <button 
            className="tools-toggle-btn"
            onClick={() => setShowTools(!showTools)}
          >
            {showTools ? '▼ Скрыть панель' : '▲ Разметка области'}
          </button>
        </div>

        {/* Раскрывающаяся панель инструментов */}
        {showTools && (
          <div className="tools-panel">
            {/* Столбик Проект */}
            <div className="tools-section">
              <h4>💾 Проект</h4>
              
              <div className="tool-buttons">
                <button className="tool-btn" onClick={handleLoadProject}>
                  📂 Загрузить проект
                </button>

                <button className="tool-btn" onClick={handleSaveProject}>
                  💾 Сохранить проект
                </button>
                
                <input
                  type="file"
                  accept="image/*,.tif,.tiff,.geotiff"
                  onChange={handleImageUpload}
                  id="map-upload"
                  className="file-input"
                />
                <label htmlFor="map-upload" className="tool-btn">
                  📷 Загрузить карту
                </label>

                <button 
                  className="tool-btn" 
                  onClick={() => {
                    if (eventLogger.getEvents().length === 0) {
                      alert('Журнал событий пуст. Запустите моделирование для генерации событий.');
                      return;
                    }
                    const filename = `simulation_events_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
                    eventLogger.downloadCSV(filename);
                    alert(`Журнал событий экспортирован!\nСобытий: ${eventLogger.getEvents().length}`);
                  }}
                  title="Экспортировать журнал событий в CSV"
                >
                  📋 Экспорт журнала событий
                </button>
              </div>
            </div>

            {/* Столбик Инструменты разметки в 2 колонки */}
            <div className="tools-section">
              <h4>🛠️ Инструменты разметки</h4>
              <div className="tool-buttons">
                <button 
                  className={`tool-btn ${tool === 'select' ? 'active' : ''}`}
                  onClick={() => setTool('select')}
                >
                  👆 Выделение
                </button>
                <button 
                  className={`tool-btn ${tool === 'polygon' ? 'active' : ''}`}
                  onClick={() => {
                    if (simulationArea) {
                      alert('Удалите существующую область для создания новой');
                    } else {
                      setTool('polygon');
                    }
                  }}
                >
                  🔶 Область
                </button>
                <button
                  className="tool-btn danger"
                  onClick={() => deleteElement(simulationArea)}
                  disabled={isSimulationRunning || !simulationArea || !selectedProcess}
                >
                  🗑️ Удалить
                </button>
                <button 
                  className={`tool-btn ${tool === 'point' ? 'active' : ''}`}
                  onClick={() => setTool('point')}
                  disabled={isSimulationRunning || !simulationArea || !selectedProcess}
                >
                  🔴 Начало
                </button>
                <button 
                  className={`tool-btn ${tool === 'object' ? 'active' : ''}`}
                  onClick={() => setTool('object')}
                  disabled={isSimulationRunning || !simulationArea || !selectedProcess}
                >
                  📍 Объект
                </button>
                <button 
                  className={`tool-btn ${tool === 'event' ? 'active' : ''}`}
                  onClick={() => setTool('event')}
                  disabled={isSimulationRunning || !simulationArea || !selectedProcess}
                >
                  ⚡ Событие
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Панель свойств объекта/события */}
      {showProperties && (selectedObject || pendingObjectPos || pendingEventPos) && (
        <div className="object-properties-panel">
          <div className="properties-header">
            <h4>
              ⚙️ {isCreatingObject
                ? 'Добавление объекта'
                : selectedObject && selectedObject.type === 'eventPoint'
                  ? 'Свойства события'
                  : selectedObject && selectedObject.type !== 'eventPoint'
                  ? 'Свойства объекта'
                  : 'Добавление события'}
            </h4>
            <button 
              onClick={() => {
                setShowProperties(false);
                setPendingObjectPos(null);
                setPendingStartPoint(null);
                setNewObjectDraft({
                  name: '',
                  objectTypeId: '',
                  properties: {},
                  isNewType: false,
                  newTypeId: '',
                  newTypeName: '',
                  saveType: false
                });
                // Не сбрасываем selectedObject, чтобы можно было снова его выбрать
              }} 
              className="close-btn"
            >
              ✕
            </button>
          </div>
          
          <div className="properties-form">
            {/* Режим добавления объекта */}
            {isCreatingObject && (
              <>
                <div className="form-group">
                  <label>Название объекта:</label>
                  <input
                    type="text"
                    value={newObjectDraft.name}
                    onChange={(e) => {
                      setNewObjectDraft(prev => ({ ...prev, name: e.target.value }));
                    }}
                    placeholder={`object_${elements.filter(e => e.type === 'object').length + 1}`}
                  />
                  {!newObjectDraft.name && (
                    <small>Будет использовано: object_{elements.filter(e => e.type === 'object').length + 1}</small>
                  )}
                </div>

                <div className="form-group">
                  <label>Тип объекта:</label>
                  <select
                    value={newObjectDraft.objectTypeId}
                    onChange={(e) => {
                      const selectedType = objectTypes.find(t => t.id === e.target.value);
                      if (selectedType) {
                        // Загружаем параметры из defaultProperties или props
                        const defaultProps = selectedType.defaultProperties || selectedType.props || {};
                        setNewObjectDraft(prev => ({
                          ...prev,
                          objectTypeId: e.target.value,
                          properties: { ...defaultProps } // Копируем параметры
                        }));
                        console.log('Выбран тип:', selectedType.name, 'Параметры:', defaultProps);
                      } else {
                        setNewObjectDraft(prev => ({
                          ...prev,
                          objectTypeId: e.target.value,
                          properties: {}
                        }));
                      }
                    }}
                  >
                    <option value="">-- Выберите тип объекта --</option>
                    {objectTypes.map(type => (
                      <option key={type.id} value={type.id}>
                        {type.icon || '📦'} {type.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Динамические параметры для выбранного типа */}
                {newObjectDraft.objectTypeId && (
                  <div className="dynamic-params-section">
                    <h5>Параметры объекта:</h5>
                    {Object.entries(
                      objectTypes.find(t => t.id === newObjectDraft.objectTypeId)?.defaultProperties || 
                      objectTypes.find(t => t.id === newObjectDraft.objectTypeId)?.props || {}
                    ).map(([key, defaultValue]) => (
                      <div className="form-group" key={key}>
                        <label>{key}:</label>
                        <input
                          type={typeof defaultValue === 'number' ? 'number' : 'text'}
                          step={typeof defaultValue === 'number' ? 'any' : undefined}
                          value={newObjectDraft.properties[key] !== undefined ? newObjectDraft.properties[key] : defaultValue}
                          onChange={(e) => {
                            let value = e.target.value;
                            if (typeof defaultValue === 'number') {
                              value = parseFloat(value);
                              if (isNaN(value)) value = defaultValue;
                            }
                            setNewObjectDraft(prev => ({
                              ...prev,
                              properties: {
                                ...prev.properties,
                                [key]: value
                              }
                            }));
                          }}
                        />
                        <small>Значение по умолчанию: {String(defaultValue)}</small>
                      </div>
                    ))}
                  </div>
                )}

                {/* Создание нового типа */}
                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={newObjectDraft.isNewType}
                      onChange={(e) => {
                        setNewObjectDraft(prev => ({
                          ...prev,
                          isNewType: e.target.checked,
                          objectTypeId: e.target.checked ? '' : prev.objectTypeId,
                          properties: e.target.checked ? {} : prev.properties
                        }));
                      }}
                    />
                    <span>Создать новый тип объекта</span>
                  </label>
                </div>

                {newObjectDraft.isNewType && (
                  <div className="new-type-section">
                    <div className="form-group">
                      <label>ID нового типа (латиницей):</label>
                      <input
                        type="text"
                        value={newObjectDraft.newTypeId}
                        onChange={(e) => {
                          const id = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_');
                          setNewObjectDraft(prev => ({
                            ...prev,
                            newTypeId: id
                          }));
                        }}
                        placeholder="например: new_object_type"
                      />
                      <small>Только латинские буквы, цифры и подчеркивания</small>
                    </div>
                    
                    <div className="form-group">
                      <label>Название нового типа:</label>
                      <input
                        type="text"
                        value={newObjectDraft.newTypeName}
                        onChange={(e) => {
                          setNewObjectDraft(prev => ({
                            ...prev,
                            newTypeName: e.target.value
                          }));
                        }}
                        placeholder="Например: Новый объект"
                      />
                    </div>
                    
                    <div className="form-group">
                      <label>Параметры объекта:</label>
                      <div className="params-editor">
                        <div className="params-list">
                          {Object.entries(newObjectDraft.properties).map(([key, value]) => (
                            <div key={key} className="param-item">
                              <input
                                type="text"
                                className="param-key"
                                value={key}
                                onChange={(e) => {
                                  const newKey = e.target.value;
                                  const newProperties = { ...newObjectDraft.properties };
                                  const oldValue = newProperties[key];
                                  delete newProperties[key];
                                  newProperties[newKey] = oldValue;
                                  setNewObjectDraft(prev => ({
                                    ...prev,
                                    properties: newProperties
                                  }));
                                }}
                                placeholder="название"
                              />
                              <input
                                type="text"
                                className="param-value-input"
                                value={String(value)}
                                onChange={(e) => {
                                  let newValue = e.target.value;
                                  // Пытаемся преобразовать в число, если это возможно
                                  if (!isNaN(newValue) && newValue.trim() !== '') {
                                    newValue = parseFloat(newValue);
                                  }
                                  setNewObjectDraft(prev => ({
                                    ...prev,
                                    properties: {
                                      ...prev.properties,
                                      [key]: newValue
                                    }
                                  }));
                                }}
                                placeholder="значение"
                              />
                              <button
                                type="button"
                                className="remove-param-btn"
                                onClick={() => {
                                  const newProperties = { ...newObjectDraft.properties };
                                  delete newProperties[key];
                                  setNewObjectDraft(prev => ({
                                    ...prev,
                                    properties: newProperties
                                  }));
                                }}
                                title="Удалить параметр"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="add-param-btn"
                          onClick={() => {
                            const newKey = `param_${Object.keys(newObjectDraft.properties).length + 1}`;
                            setNewObjectDraft(prev => ({
                              ...prev,
                              properties: {
                                ...prev.properties,
                                [newKey]: ""
                              }
                            }));
                          }}
                        >
                          + Добавить параметр
                        </button>
                      </div>
                      <small>
                        💡 Добавьте параметры для нового типа объекта. Значения могут быть числами или текстом.
                      </small>
                    </div>
                    
                    <div className="form-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={newObjectDraft.saveType}
                          onChange={(e) => {
                            setNewObjectDraft(prev => ({
                              ...prev,
                              saveType: e.target.checked
                            }));
                          }}
                        />
                        <span>Сохранить этот тип для будущего использования</span>
                      </label>
                    </div>
                  </div>
                )}

                <div className="form-group">
                  <label>Размер объекта (по умолчанию 6px):</label>
                  <input
                    type="range"
                    min={6}
                    max={40}
                    step={1}
                    defaultValue={6}
                    disabled
                  />
                  <small>Размер можно будет изменить после добавления, выбрав объект на карте</small>
                </div>

                <div className="form-actions">
                  <button 
                    onClick={confirmAddObject} 
                    className="save-btn"
                    disabled={isCreatingObject && !newObjectDraft.objectTypeId && !newObjectDraft.isNewType}
                  >
                    Добавить объект
                  </button>
                </div>
              </>
            )}

            {/* РЕЖИМ РЕДАКТИРОВАНИЯ ОБЪЕКТА */}
            {!isCreatingObject && selectedObject && selectedObject.type === 'object' && (
              <>
                <div className="form-group">
                  <label>Название объекта:</label>
                  <input
                    type="text"
                    value={selectedObject.label || ''}
                    onChange={(e) => {
                      const updatedElements = elements.map(el => {
                        if (el.id === selectedObject.id) {
                          return { ...el, label: e.target.value };
                        }
                        return el;
                      });
                      setElements(updatedElements);
                      const updatedSelected = updatedElements.find(el => el.id === selectedObject.id);
                      onObjectSelect(updatedSelected);
                    }}
                  />
                </div>

                <div className="form-group">
                  <label>Тип объекта:</label>
                  <div className="readonly-field">
                    <span className="type-icon">
                      {objectTypes.find(t => t.id === selectedObject.objectType)?.icon || '📦'}
                    </span>
                    <span className="type-name">
                      {objectTypes.find(t => t.id === selectedObject.objectType)?.name || selectedObject.objectType}
                    </span>
                  </div>
                  <small>Тип объекта нельзя изменить после создания</small>
                </div>

                <div className="form-group">
                  <label>Размер объекта: {selectedObject.radius || 6}px</label>
                  <input
                    type="range"
                    min={6}
                    max={40}
                    step={1}
                    value={selectedObject.radius || 6}
                    onChange={(e) => {
                      const newRadius = Number(e.target.value);
                      updateElementRadius(selectedObject.id, newRadius);
                      // Принудительно обновляем selectedObject
                      const updatedSelected = elements.find(el => el.id === selectedObject.id);
                      if (updatedSelected) {
                        onObjectSelect({ ...updatedSelected, radius: newRadius });
                      }
                    }}
                  />
                </div>

                {/* Отображение всех параметров объекта */}
                {selectedObject.properties && Object.keys(selectedObject.properties).length > 0 && (
                  <div className="dynamic-params-section">
                    <h5>Параметры объекта:</h5>
                    {Object.entries(selectedObject.properties).map(([key, value]) => {
                      if (key === 'currentState' || key === 'resistance' || key === 'capacity' || key === 'custom') return null;
                      return (
                        <div className="form-group readonly-param" key={key}>
                          <label>{key}:</label>
                          <div className="param-value">{String(value)}</div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="form-actions">
                  <button 
                      onClick={() => {
                        if (selectedObject) {
                          deleteElement(selectedObject);
                        }
                        setShowProperties(false);
                      }}
                      className="delete-btn"
                    >
                    🗑️ Удалить
                  </button>
                </div>
              </>
            )}

            {/* Режим добавления события */}
            {pendingEventPos && (
              <>
                <div className="form-group">
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <span>Название события:</span>
                  </label>
                  <input
                    type="text"
                    value={eventName}
                    onChange={(e) => setEventName(e.target.value)}
                    placeholder={`Событие ${elements.filter(e => e.type === 'eventPoint').length + 1}`}
                  />
                  <small>Данное название будет использоваться в итоговом журнале событий</small>
                </div>

                <div className="form-group">
                  <label>Размер: {eventRadius}px</label>
                  <input
                    type="range"
                    min={4}
                    max={30}
                    step={1}
                    value={eventRadius}
                    onChange={(e) => setEventRadius(Number(e.target.value))}
                  />
                </div>

                <div className="form-group">
                  <label>Тип срабатывания:</label>
                  <div className="trigger-type-selector">
                    <label className="radio-label">
                      <input
                        type="radio"
                        value="single"
                        checked={eventTriggerType === 'single'}
                        onChange={(e) => setEventTriggerType(e.target.value)}
                      />
                      <span>Однократное</span>
                      <Tooltip text="Событие сработает только один раз при первом выполнении условий">
                        <span className="help-icon">?</span>
                      </Tooltip>
                    </label>
                    <label className="radio-label">
                      <input
                        type="radio"
                        value="multiple"
                        checked={eventTriggerType === 'multiple'}
                        onChange={(e) => setEventTriggerType(e.target.value)}
                      />
                      <span>Многократное</span>
                      <Tooltip text="Событие будет срабатывать на каждом шаге моделирования, пока выполняются условия">
                        <span className="help-icon">?</span>
                      </Tooltip>
                    </label>
                  </div>
                </div>

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={eventCondition.triggerOnImpact}
                      onChange={(e) => setEventCondition(prev => ({ ...prev, triggerOnImpact: e.target.checked }))}
                    />
                    <span>Активировать при попадании в зону воздействия процесса</span>
                  </label>
                </div>

                <div className="form-group">
                  <label>Дополнительные условия:</label>
                  
                  {eventCondition.rules.map((rule, index) => (
                    <div key={index} className="rule-row">
                      {index > 0 && (
                        <select
                          value={rule.combinator}
                          onChange={(e) => updateRule(index, 'combinator', e.target.value)}
                          className="rule-combinator"
                        >
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      )}
                      
                      <select
                        value={rule.param}
                        onChange={(e) => updateRule(index, 'param', e.target.value)}
                        className="rule-param"
                      >
                        <option value="">Выберите параметр</option>
                        {getAvailableParams().map(param => (
                          <option key={param.id} value={param.id}>
                            {param.name}
                          </option>
                        ))}
                      </select>
                      
                      <select
                        value={rule.operator}
                        onChange={(e) => updateRule(index, 'operator', e.target.value)}
                        className="rule-operator"
                      >
                        <option value=">">{'>'}</option>
                        <option value="<">{'<'}</option>
                        <option value="==">==</option>
                        <option value="!=">!=</option>
                      </select>
                      
                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) => updateRule(index, 'value', e.target.value)}
                        placeholder="значение"
                        className="rule-value"
                      />
                      
                      <button
                        type="button"
                        onClick={() => removeRule(index)}
                        className="remove-rule-btn"
                        title="Удалить условие"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  
                  <button type="button" onClick={addRule} className="add-rule-btn">
                    + Добавить условие
                  </button>
                </div>

                <div className="form-group">
                  <label>Условие активации:</label>
                  <div className="condition-preview">
                    {buildConditionString()}
                  </div>
                </div>

                <div className="form-actions">
                  <button onClick={confirmAddEvent} className="save-btn">
                    Создать событие
                  </button>
                </div>
              </>
            )}
            {/* Режим редактирования события */}
            {!isCreatingObject && !pendingEventPos && selectedObject && selectedObject.type === 'eventPoint' && (
              <>
                <div className="form-group">
                  <div className="label-with-tooltip">
                    <label>Название события:</label>
                  </div>
                  <input
                    type="text"
                    value={selectedObject.label || ''}
                    onChange={(e) => {
                      const updatedElements = elements.map(el => {
                        if (el.id === selectedObject.id) {
                          return { ...el, label: e.target.value };
                        }
                        return el;
                      });
                      setElements(updatedElements);
                      const updatedSelected = updatedElements.find(el => el.id === selectedObject.id);
                      onObjectSelect(updatedSelected);
                    }}
                  />
                  <small>Данное название будет использоваться в итоговом журнале событий</small>
                </div>

                <div className="form-group">
                  <div className="label-with-tooltip">
                    <label>Размер: {selectedObject.radius || 5}px</label>
                    <Tooltip text="Размер точки события на карте">
                      <span className="help-icon">?</span>
                    </Tooltip>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={40}
                    step={1}
                    value={selectedObject.radius || 5}
                    onChange={(e) => {
                      const newRadius = Number(e.target.value);
                      updateElementRadius(selectedObject.id, newRadius);
                      const updatedSelected = elements.find(el => el.id === selectedObject.id);
                      if (updatedSelected) {
                        onObjectSelect({ ...updatedSelected, radius: newRadius });
                      }
                    }}
                  />
                </div>

                <div className="form-group">
                  <div className="label-with-tooltip">
                    <label>Тип срабатывания:</label>
                  </div>
                  <div className="readonly-field">
                    <span className="trigger-type-badge">
                      {selectedObject.triggerType === 'single' ? '🔹 Однократное' : '🔁 Многократное'}
                    </span>
                  </div>
                  <small>
                    {selectedObject.triggerType === 'single' 
                      ? 'Событие сработает только один раз и больше не будет активироваться'
                      : 'Событие будет срабатывать на каждом шаге моделирования, пока выполняются условия'}
                  </small>
                </div>

                {/* Отображение условия активации */}
                <div className="form-group">
                  <div className="label-with-tooltip">
                    <label>Условие активации:</label>
                  </div>
                  <div className="condition-view">
                    {selectedObject.condition ? (
                      <>
                        {selectedObject.condition.triggerOnImpact && (
                          <div className="condition-item">
                            <span className="condition-icon">📍</span>
                            <span>Попадание в зону воздействия процесса</span>
                          </div>
                        )}
                        {selectedObject.condition.rules && selectedObject.condition.rules.length > 0 && (
                          <div className="condition-rules">
                            <div className="condition-rules-header">
                              <span className="condition-icon">⚙️</span>
                              <span>Дополнительные условия:</span>
                            </div>
                            <div className="condition-rules-list">
                              {selectedObject.condition.rules.map((rule, idx) => {
                                // Находим параметр для отображения
                                const param = getAvailableParams().find(p => p.id === rule.param);
                                const paramName = param ? param.name : rule.param;
                                
                                let operatorDisplay = rule.operator;
                                
                                return (
                                  <div key={idx} className="condition-rule-item">
                                    {idx > 0 && (
                                      <span className="rule-combinator-badge">
                                        {rule.combinator === 'AND' ? 'AND' : 'OR'}
                                      </span>
                                    )}
                                    <span className="rule-text">
                                      {paramName} {operatorDisplay} {rule.value}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {!selectedObject.condition?.triggerOnImpact && 
                        (!selectedObject.condition?.rules || selectedObject.condition.rules.length === 0) && (
                          <div className="condition-empty">
                            ⚠️ Нет условий активации - событие никогда не сработает
                          </div>
                        )}
                        {selectedObject.condition?.triggerOnImpact && 
                        (!selectedObject.condition?.rules || selectedObject.condition.rules.length === 0) && (
                          <div className="condition-simple">
                            ✅ Событие активируется при попадании в зону воздействия
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="condition-empty">
                        ❌ Условия активации не заданы
                      </div>
                    )}
                  </div>
                </div>

                <div className="form-actions">
                  <button 
                    onClick={() => {
                      if (selectedObject) {
                        deleteElement(selectedObject);
                      }
                      setShowProperties(false);
                    }}
                    className="delete-btn"
                  >
                    🗑️ Удалить событие
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Модальное окно с кодом процесса */}
      {showProcessCode && (
        <ProcessCodeModal 
          process={selectedProcessForCode} 
          onClose={() => {
            setShowProcessCode(false);
            setSelectedProcessForCode(null);
          }} 
        />
      )}

      {/* Модальное окно настроек моделирования */}
      {showSimulationSetup && (
        <SimulationSetupModal
          onClose={() => {
            setShowSimulationSetup(false);
            setPendingStartPoint(null);
          }}
          onConfirm={confirmSimulationSetup}
          process={selectedProcess}
          defaultParams={{
            maxIterations: 150,
            numRuns: 1,
            environmentParams: selectedProcess?.defaultEnvironmentValues || {}
          }}
        />
      )}

      {/* Панель истории запусков */}
      {(simulationHistory.length > 0) && (
        <div className="simulation-history-panel">
          <div className="history-header">
            <h4>История запусков ({simulationHistory.length})</h4>
            {isShowingHistory && (
              <button 
                className="close-history-btn"
                onClick={() => {
                  setIsShowingHistory(false);
                  setCurrentRunIndex(-1);
                  // Не очищаем состояния, чтобы можно было вернуться
                }}
              >
                ✕
              </button>
            )}
          </div>
          
          <div className="history-tabs">
            {simulationHistory.map((run, idx) => (
              <button
                key={run.id}
                className={`history-tab ${currentRunIndex === idx ? 'active' : ''}`}
                onClick={() => loadRunFromHistory(idx)}
              >
                <span className="run-number">#{run.runNumber}</span>
                <span className="run-stats">
                  {run.iterations} итер. | {formatTime(run.realTime)}
                </span>
              </button>
            ))}
          </div>
          
          {isShowingHistory && currentRunIndex >= 0 && simulationHistory[currentRunIndex] && (
            <div className="history-info">
              <span>Запуск #{simulationHistory[currentRunIndex].runNumber}</span>
              <span>Время: {formatTime(simulationHistory[currentRunIndex].realTime || 0)}</span>
              <span>Итерации: {simulationHistory[currentRunIndex].iterations}</span>
              <span>Параметры: {Object.entries(simulationHistory[currentRunIndex].environmentParams || {}).map(([k,v]) => `${k}=${v.toFixed?.(2) || v}`).join(', ')}</span>
              <button 
                className="export-run-btn"
                onClick={() => {
                  const run = simulationHistory[currentRunIndex];
                  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `simulation-run-${run.runNumber}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Экспорт JSON
              </button>
              <button 
                className="export-image-btn"
                onClick={exportCurrentViewAsImage}
                title="Экспортировать текущее состояние как изображение"
              >
                Экспорт PNG
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default MapCanvas;