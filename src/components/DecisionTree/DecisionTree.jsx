import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import './DecisionTree.css';
import eventLogger from '../Analytics/EventLogger';

const DecisionTree = ({ 
  isSimulationRunning, 
  onRunChange, 
  currentStep, 
  simulationState, 
  selectedProcess,
  elements,
  getAvailableParams,
  onObjectActionsApply,
  onExecutionConditionFailed,
}) => {
  const containerRef = useRef(null);
  const currentActionEventIdRef = useRef(null);
  const parallelActionEventIdRef = useRef(null);
  const parallelStartTimesRef = useRef({});
  const processNodeCompletionRef = useRef(null);

  const [treeData, setTreeData] = useState({
    id: 'root',
    name: 'Начало',
    type: 'start',
    x: 400,
    y: 40,
    children: []
  });

  const [selectedNode, setSelectedNode] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingNode, setEditingNode] = useState(null);
  const [parallelNodes, setParallelNodes] = useState(new Set()); // ID параллельно выполняющихся узлов
  const [newNode, setNewNode] = useState({
    name: '',
    responsible: '',
    duration: { value: 1, unit: 'min' },
    eventName: '',
    parallel: false,
    startCondition: { rules: [] },
    executionCondition: { rules: [], description: '' },
    objectActions: [],
    condition: { triggerOnImpact: false, rules: [] }
  });
  
  // Состояния для анимации выполнения
  const [currentNodeId, setCurrentNodeId] = useState(null);
  const [completedNodes, setCompletedNodes] = useState(new Set());
  const [nodeStartTime, setNodeStartTime] = useState(null);
  const [showDecisionPrompt, setShowDecisionPrompt] = useState(false);
  const [pendingDecisionNode, setPendingDecisionNode] = useState(null);
  const [executionPath, setExecutionPath] = useState([]);
  const [tick, setTick] = useState(0);
  const [isTreeCompleted, setIsTreeCompleted] = useState(false);
  const decisionLoggedRef = useRef(new Set());
  
  // Состояния для подсказки
  const [tooltipNode, setTooltipNode] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  const prevTreeRef = useRef(null);
  const [layoutVersion, setLayoutVersion] = useState(0);

  // Получение доступных параметров
  const getAvailableParamsCombined = useCallback(() => {
    if (getAvailableParams) {
      return getAvailableParams();
    }
    return [];
  }, [getAvailableParams]);

  // Проверка, является ли узел точкой принятия решения (Decision Node)
  const isDecisionNode = useCallback((node) => {
    if (!node.children || node.children.length <= 1) return false;
    
    const hasConditionalChild = node.children.some(child => 
      (child.startCondition?.rules?.length > 0) || child.startCondition?.triggerOnImpact
    );
    
    return !hasConditionalChild;
  }, []);

  // Конвертация длительности в миллисекунды
  const durationToMs = useCallback((duration) => {
    if (!duration) return 1000;
    const { value, unit } = duration;
    switch (unit) {
      case 'sec': return value * 1000;
      case 'min': return value * 60 * 1000;
      case 'hour': return value * 60 * 60 * 1000;
      default: return value * 1000;
    }
  }, []);

  // Запуск выполнения дерева
  const startTreeExecution = useCallback(() => {
    decisionLoggedRef.current.clear();
    setIsTreeCompleted(false);
    setCompletedNodes(new Set());
    setExecutionPath([]);
    setCurrentNodeId('root');
    setNodeStartTime(Date.now());
    setShowDecisionPrompt(false);
    setPendingDecisionNode(null);

    const startEvt = eventLogger.startAction({
      name: treeData.name,
      nodeId: 'root',
      responsible: '',
      parallel: false,
      isDecision: false,
      iteration: 0
    });
    currentActionEventIdRef.current = startEvt.id;
  }, [treeData]);

  const findNode = useCallback((node, id) => {
    if (node.id === id) return node;
    if (node.children) {
      for (let child of node.children) {
        const found = findNode(child, id);
        if (found) return found;
      }
    }
    return null;
  }, []);

  const checkConditions = useCallback((rules, simState, els) => {
    if (!rules || rules.length === 0) return true;

    return rules.reduce((result, rule, index) => {
      if (!rule.param || !rule.operator) return result;

      let actualValue;

      // Параметр объекта карты: object.<objectId>.<property>
      if (rule.param.startsWith('object.')) {
        const parts = rule.param.split('.');
        const objectId = parts[1];
        const property = parts[2];
        const el = els?.find(e => e.id === objectId);
        actualValue = el?.properties?.[property];
      }
      // Параметр симуляции: simulation.<field>
      else if (rule.param.startsWith('simulation.')) {
        const field = rule.param.split('.')[1];
        actualValue = simState?.[field];
      }
      // Параметр среды: env.<paramId>
      else if (rule.param.startsWith('env.')) {
        const field = rule.param.split('.')[1];
        actualValue = simState?.environmentParams?.[field];
      }

      if (actualValue === undefined) return result;

      // Приводим типы
      const actual = typeof actualValue === 'boolean'
        ? actualValue
        : isNaN(actualValue) ? actualValue : Number(actualValue);
      const expected = rule.value === 'true' ? true
        : rule.value === 'false' ? false
        : isNaN(rule.value) ? rule.value : Number(rule.value);

      let conditionMet;
      switch (rule.operator) {
        case '>':  conditionMet = actual > expected; break;
        case '<':  conditionMet = actual < expected; break;
        case '>=': conditionMet = actual >= expected; break;
        case '<=': conditionMet = actual <= expected; break;
        case '==': conditionMet = actual == expected; break;
        case '!=': conditionMet = actual != expected; break;
        default:   conditionMet = false;
      }

      if (index === 0) return conditionMet;
      return rule.combinator === 'OR' ? result || conditionMet : result && conditionMet;
    }, true);
  }, []);

  // Обработка завершения узла и переход к следующему
  const processNodeCompletion = useCallback(() => {
    if (!currentNodeId) return;

    const currentNode = findNode(treeData, currentNodeId);
    if (!currentNode) return;

    // Завершаем текущее действие (если это не параллельный узел)
    if (currentActionEventIdRef.current && !currentNode.parallel) {
      eventLogger.endAction(currentActionEventIdRef.current, (Date.now() - nodeStartTime) / 1000);
    }

    // Применяем objectActions
    if (currentNode.objectActions?.length > 0) {
      onObjectActionsApply?.(currentNode.objectActions);
    }

    // Если есть "Событие по окончании" — добавляем как событие, связанное с действием
    if (currentNode.eventName?.trim() && currentActionEventIdRef.current) {
      const completionEvent = eventLogger.addCompletionEvent({
        eventName: currentNode.eventName,
        nodeId: currentNode.id,
        nodeName: currentNode.name,
        causeActionId: currentActionEventIdRef.current,
        iteration: simulationState?.iteration || 0
      });
      if (completionEvent) {
        const actionRecord = eventLogger.getEvents().find(e => e.id === currentActionEventIdRef.current);
        if (actionRecord) actionRecord.result_id = completionEvent.id;
      }
    }

    setCompletedNodes(prev => new Set([...prev, currentNodeId]));
    setExecutionPath(prev => [...prev, currentNodeId]);

    // Decision node — показываем выбор
    if (isDecisionNode(currentNode) && currentNode.children?.length > 0) {
      setPendingDecisionNode(currentNode);
      setShowDecisionPrompt(true);
      return;
    }

    // Нет детей — конец ветки
    if (!currentNode.children || currentNode.children.length === 0) {
      setCurrentNodeId(null);
      setIsTreeCompleted(true);
      return;
    }

    const nextNode = currentNode.children[0];

    // Проверяем startCondition перед переходом
    if (nextNode.startCondition?.rules?.length > 0) {
      const canStart = checkConditions(nextNode.startCondition.rules, simulationState, elements);
      if (!canStart) {
        const waitInterval = setInterval(() => {
          const ok = checkConditions(nextNode.startCondition.rules, simulationState, elements);
          if (ok) {
            clearInterval(waitInterval);
            setCurrentNodeId(nextNode.id);
            setNodeStartTime(Date.now());
          }
        }, 2000);
        return;
      }
    }

    // Параллекльный узел
    if (nextNode.parallel) {

      // старт параллельного действия
      const parallelActionEvt = eventLogger.startAction({
        name: nextNode.name,
        nodeId: nextNode.id,
        responsible: nextNode.responsible,
        parallel: true,
        iteration: simulationState?.iteration || 0
      });

      const parallelActionId = parallelActionEvt.id;

      parallelStartTimesRef.current[nextNode.id] = Date.now();

      setParallelNodes(prev => new Set([...prev, nextNode.id]));

      setTimeout(() => {

        eventLogger.endAction(
          parallelActionId,
          durationToMs(nextNode.duration) / 1000
        );

        if (nextNode.objectActions?.length > 0) {
          onObjectActionsApply?.(nextNode.objectActions);
        }

        if (nextNode.eventName?.trim()) {
          eventLogger.addCompletionEvent({
            eventName: nextNode.eventName,
            nodeId: nextNode.id,
            nodeName: nextNode.name,
            causeActionId: parallelActionId,
            iteration: simulationState?.iteration || 0
          });
        }

        setParallelNodes(prev => {
          const s = new Set(prev);
          s.delete(nextNode.id);
          return s;
        });

      }, durationToMs(nextNode.duration));

      // Основной поток идёт дальше через 10 сек.
      setTimeout(() => {

        if (nextNode.children?.length > 0) {

          const childNode = nextNode.children[0];

          const childEvt = eventLogger.startAction({
            name: childNode.name,
            nodeId: childNode.id,
            responsible: childNode.responsible,
            parallel: false,
            iteration: simulationState?.iteration || 0
          });

          currentActionEventIdRef.current = childEvt.id;

          setCurrentNodeId(childNode.id);
          setNodeStartTime(Date.now());
        }

      }, 10000); // 10 секунд

      return;
    }

    // Обычный последовательный узел
    const nextEvt = eventLogger.startAction({
      name: nextNode.name,
      nodeId: nextNode.id,
      responsible: nextNode.responsible,
      parallel: false,
      iteration: simulationState?.iteration || 0
    });
    currentActionEventIdRef.current = nextEvt.id;

    setCurrentNodeId(nextNode.id);
    setNodeStartTime(Date.now());
  }, [currentNodeId, treeData, isDecisionNode, onObjectActionsApply, findNode, checkConditions, simulationState, elements, durationToMs]);

  // Выбор ветки пользователем
  const selectBranch = useCallback((branchNode) => {
    if (!pendingDecisionNode) return;

    if (decisionLoggedRef.current.has(pendingDecisionNode.id)) return;
    decisionLoggedRef.current.add(pendingDecisionNode.id);

    eventLogger.addDecisionChoice({
      decisionNodeId: pendingDecisionNode.id,
      decisionNodeName: pendingDecisionNode.name,
      selectedBranch: branchNode.name,
      iteration: simulationState?.iteration || 0
    });

    const branchEvt = eventLogger.startAction({
      name: branchNode.name,
      nodeId: branchNode.id,
      responsible: branchNode.responsible || '',
      parallel: false,
      iteration: simulationState?.iteration || 0
    });
    currentActionEventIdRef.current = branchEvt.id;

    setShowDecisionPrompt(false);
    setCurrentNodeId(branchNode.id);
    setNodeStartTime(Date.now());
    setPendingDecisionNode(null);
    setExecutionPath(prev => [...prev, `decision_${pendingDecisionNode.id}_branch_${branchNode.id}`]);
  }, [pendingDecisionNode, simulationState]);

  useEffect(() => {
    if (!currentNodeId || !nodeStartTime) return;
    const interval = setInterval(() => {
      setTick(t => t + 1); // вызывает ре-рендер каждые 200мс
    }, 200);
    return () => clearInterval(interval);
  }, [currentNodeId, nodeStartTime]);

  // Таймер для отслеживания времени выполнения узла
  useEffect(() => {
    if (!isSimulationRunning || !currentNodeId || !nodeStartTime) return;

    // Если узел уже в completedNodes — не запускаем таймер
    // (параллельный узел завершается через свой setTimeout, не через этот таймер)
    const currentNode = findNode(treeData, currentNodeId);
    if (!currentNode || currentNode.parallel) return; // параллельные — не трогаем

    let fired = false; // защита от двойного срабатывания

    const interval = setInterval(() => {
      if (fired) { clearInterval(interval); return; }

      const durationMs = durationToMs(currentNode.duration || { value: 1, unit: 'sec' });
      const elapsed = Date.now() - nodeStartTime;

      if (elapsed >= durationMs) {
        fired = true;
        clearInterval(interval);
        processNodeCompletionRef.current?.();
      }
    }, 300);

    return () => clearInterval(interval);
  }, [isSimulationRunning, currentNodeId, nodeStartTime, treeData, durationToMs, findNode]);


  // Запуск выполнения при старте симуляции
  useEffect(() => {
    if (isSimulationRunning && !currentNodeId && !isTreeCompleted) {
      startTreeExecution();
    }
  }, [isSimulationRunning, currentNodeId, startTreeExecution, isTreeCompleted]);

  // Сброс при остановке симуляции
  useEffect(() => {
    if (!isSimulationRunning) {
      setCurrentNodeId(null);
      setCompletedNodes(new Set());
      setNodeStartTime(null);
      setShowDecisionPrompt(false);
      setPendingDecisionNode(null);
      setIsTreeCompleted(false);
      setExecutionPath([]);
    }
  }, [isSimulationRunning]);

  // Расчет позиций узлов
  const calculatePositions = useCallback((node, startX, levelHeight, levelWidth, parentX = null) => {
    if (!node.children || node.children.length === 0) {
      node.x = startX;
      node.y = levelHeight;
      return { width: 1, x: startX };
    }
    
    node.y = levelHeight;
    const childWidth = 180;
    const totalChildren = node.children.length;
    const totalWidth = totalChildren * childWidth;
    
    const childrenResults = [];
    let currentX = startX - totalWidth / 2 + childWidth / 2;
    
    node.children.forEach((child, index) => {
      const childStartX = currentX + index * childWidth;
      const result = calculatePositions(child, childStartX, levelHeight + 70, childWidth, startX);
      childrenResults.push(result);
    });
    
    const childrenX = childrenResults.map(r => r.x);
    const minChildX = Math.min(...childrenX);
    const maxChildX = Math.max(...childrenX);
    node.x = (minChildX + maxChildX) / 2;
    
    return { width: totalWidth, x: node.x };
  }, []);

  // Пересчет позиций при изменении дерева
  useEffect(() => {
    if (!containerRef.current || !treeData) return;
    const containerWidth = containerRef.current.clientWidth;
    calculatePositions(treeData, containerWidth / 2, 60, containerWidth);
    setLayoutVersion(v => v + 1);
  }, [treeData]);

  useEffect(() => {
    if (!isSimulationRunning || parallelNodes.size === 0) return;
    
    const interval = setInterval(() => {
      const newParallelNodes = new Set(parallelNodes);
      let hasChanges = false;
      
      parallelNodes.forEach(nodeId => {
        const node = findNode(treeData, nodeId);
        if (!node) {
          newParallelNodes.delete(nodeId);
          hasChanges = true;
          return;
        }
        
        // Проверяем завершение параллельного узла
        const startTime = parallelStartTimesRef.current[nodeId] || 0;
        const durationMs = durationToMs(node.duration || { value: 10, unit: 'sec' });
        
        if (startTime && Date.now() - startTime >= durationMs) {
          newParallelNodes.delete(nodeId);
          hasChanges = true;
          // Применяем действия при завершении
          if (node.objectActions?.length > 0) {
            onObjectActionsApply?.(node.objectActions);
          }
        }
      });
      
      if (hasChanges) {
        setParallelNodes(newParallelNodes);
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, [isSimulationRunning, parallelNodes, treeData, durationToMs, onObjectActionsApply, findNode]);

  // Обработчики для подсказки
  const handleMouseEnter = useCallback((e, node) => {
    if (isDecisionNode(node)) {
      const rect = e.target.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (containerRect) {
        setTooltipPos({
          x: rect.right - containerRect.left + 10,
          y: rect.top - containerRect.top + 20
        });
      }
      setTooltipNode(node);
    }
  }, [isDecisionNode]);

  const handleMouseLeave = useCallback(() => {
    setTooltipNode(null);
  }, []);

  // Открытие модального окна для добавления узла
  const openAddModal = useCallback(() => {
    if (!selectedNode) {
      alert('Сначала выберите узел, к которому хотите добавить действие');
      return;
    }
    
    const childrenCount = selectedNode.children ? selectedNode.children.length : 0;
    if (childrenCount >= 3) {
      alert('Максимум 3 альтернативы. Нельзя добавить больше дочерних узлов');
      return;
    }
    
    setEditingNode(null);
    setNewNode({
      name: '',
      responsible: '',
      duration: { value: 1, unit: 'min' },
      eventName: '',
      parallel: false,
      executionCondition: { rules: [], description: '' },
      startCondition: { rules: [] },
      objectActions: [],
      condition: { triggerOnImpact: false, rules: [] }
    });
    setShowModal(true);
  }, [selectedNode]);

  // Открытие модального окна для редактирования узла
  const openEditModal = useCallback((node) => {
    if (node.id === 'root') return;
    setEditingNode(node);
    setNewNode({
      name: node.name,
      responsible: node.responsible || '',
      duration: node.duration || { value: 1, unit: 'min' },
      eventName: node.eventName || '',
      parallel: node.parallel || false,
      startCondition: node.startCondition || { rules: [] },
      executionCondition: node.executionCondition || { rules: [], description: '' },
      objectActions: node.objectActions || [],
      condition: node.condition || { triggerOnImpact: false, rules: [] }
    });
    setShowModal(true);
  }, []);

  // Добавление правила условия
  const addConditionRule = useCallback(() => {
    setNewNode(prev => ({
      ...prev,
      condition: {
        ...prev.condition,
        rules: [
          ...prev.condition.rules,
          { param: '', operator: '>', value: '', combinator: prev.condition.rules.length > 0 ? 'AND' : '' }
        ]
      }
    }));
  }, []);

  const updateConditionRule = useCallback((index, field, value) => {
    setNewNode(prev => {
      const newRules = [...prev.condition.rules];
      newRules[index] = { ...newRules[index], [field]: value };
      return {
        ...prev,
        condition: { ...prev.condition, rules: newRules }
      };
    });
  }, []);

  const removeConditionRule = useCallback((index) => {
    setNewNode(prev => ({
      ...prev,
      condition: {
        ...prev.condition,
        rules: prev.condition.rules.filter((_, i) => i !== index)
      }
    }));
  }, []);

  // Сохранение узла
  const saveNode = useCallback(() => {
    if (!newNode.name.trim()) {
      alert('Введите название узла');
      return;
    }
    if (editingNode) {
      const updateNode = (node) => {
        if (node.id === editingNode.id) {
          node.name = newNode.name;
          node.responsible = newNode.responsible;
          node.duration = newNode.duration;
          node.eventName = newNode.eventName;
          node.parallel = newNode.parallel;
          node.startCondition = newNode.startCondition;
          node.executionCondition = newNode.executionCondition;
          node.objectActions = newNode.objectActions;
          node.condition = newNode.condition;
          return true;
        }
        if (node.children) {
          for (let child of node.children) {
            if (updateNode(child)) return true;
          }
        }
        return false;
      };
      const updatedTree = { ...treeData };
      updateNode(updatedTree);
      setTreeData(updatedTree);
      setSelectedNode({ ...editingNode, ...newNode });
    } else {
      const nodeToAdd = {
        id: `node_${Date.now()}`,
        name: newNode.name,
        responsible: newNode.responsible,
        duration: newNode.duration,
        eventName: newNode.eventName,
        parallel: newNode.parallel,
        startCondition: newNode.startCondition,
        executionCondition: newNode.executionCondition,
        objectActions: newNode.objectActions,
        condition: newNode.condition,
        type: 'action',
        status: 'pending',
        children: []
      };
      
      const addToNode = (node) => {
        if (node.id === selectedNode.id) {
          if (!node.children) node.children = [];
          node.children.push(nodeToAdd);
          return true;
        }
        if (node.children) {
          for (let child of node.children) {
            if (addToNode(child)) return true;
          }
        }
        return false;
      };
      
      const updatedTree = { ...treeData };
      addToNode(updatedTree);
      setTreeData(updatedTree);
    }
    
    setShowModal(false);
  }, [newNode, editingNode, selectedNode, treeData]);

  useEffect(() => {
    processNodeCompletionRef.current = processNodeCompletion;
  }, [processNodeCompletion]);
  
  // Удаление узла
  const deleteNode = useCallback(() => {
    if (!selectedNode || selectedNode.id === 'root') return;
    
    if (window.confirm(`Удалить узел "${selectedNode.name}" и все его дочерние элементы?`)) {
      const removeFromTree = (node) => {
        if (node.children) {
          node.children = node.children.filter(child => child.id !== selectedNode.id);
          node.children.forEach(child => removeFromTree(child));
        }
      };
      const updatedTree = { ...treeData };
      removeFromTree(updatedTree);
      setTreeData(updatedTree);
      setSelectedNode(null);
      setShowModal(false);
    }
  }, [selectedNode, treeData]);

  // Форматирование длительности
  const formatDuration = useCallback((duration) => {
    if (!duration) return '';
    const { value, unit } = duration;
    const unitMap = { sec: 'сек', min: 'мин', hour: 'ч' };
    return `${value} ${unitMap[unit] || unit}`;
  }, []);

  // Получение цвета узла
  const getNodeColor = useCallback((node) => {
    const isCurrent = currentNodeId === node.id;
    const isCompleted = completedNodes.has(node.id);
    const isParallel = parallelNodes.has(node.id);
    const isDecision = isDecisionNode(node);

    if (isCompleted) return '#10b981';
    if (isDecision && !isCompleted) return '#f97316';
    if (node.type === 'start' || isCompleted) {
      return '#10b981';
    } else if (isCurrent) {
      return '#f59e0b';
    } else if ((isParallel || node.parallel) && !isCompleted) {
      return '#38bdf8';
    } else if (isDecision && !isCompleted) {
      return '#f97316'
    } else {
      return "#3b82f6";
    }
  }, [currentNodeId, completedNodes, parallelNodes, isDecisionNode]);

  // Отрисовка ребер
  const renderEdges = useCallback((node) => {
    const edges = [];
    if (node.children && node.children.length > 0) {
      node.children.forEach(child => {
        if (child.x && child.y) {
          edges.push(
            <line
              key={`edge-${node.id}-${child.id}`}
              x1={node.x}
              y1={node.y + 25}
              x2={child.x}
              y2={child.y - 20}
              stroke="#3b82f6"
              strokeWidth="2"
            />
          );
        }
        edges.push(...renderEdges(child));
      });
    }
    return edges;
  }, []);

  // Отрисовка узлов
  const renderNode = useCallback((node) => {
    const isSelected = selectedNode?.id === node.id;
    const isStart = node.type === 'start';
    const hasChildren = node.children && node.children.length > 0;
    const childrenCount = node.children ? node.children.length : 0;
    const isMaxChildren = childrenCount >= 3;
    const isDecision = isDecisionNode(node);
    const nodeColor = getNodeColor(node);
    const isCurrent = currentNodeId === node.id;
    const isCompleted = completedNodes.has(node.id);
    
    const isParallel = parallelNodes.has(node.id);

    let progressPercent = 0;
    if (isCurrent && nodeStartTime && node.duration) {
      const durationMs = durationToMs(node.duration);
      const elapsed = Date.now() - nodeStartTime;
      progressPercent = Math.min(100, Math.max(0, (elapsed / durationMs) * 100));
    }

    // Для параллельных узлов прогресс считаем отдельно
    let parallelProgress = 0;

    const parallelStartTime = parallelStartTimesRef.current[node.id];

    if (isParallel && parallelStartTime && node.duration) {
      const durationMs = durationToMs(node.duration);
      const elapsed = Date.now() - parallelStartTime;

      parallelProgress = Math.min(100, Math.max(0, (elapsed / durationMs) * 100));
    }
    
    return (
      <g 
        key={node.id}
        onMouseEnter={(e) => handleMouseEnter(e, node)}
        onMouseLeave={handleMouseLeave}
      >
        <rect
          x={node.x - 80}
          y={node.y - 20}
          width="160"
          height="50"
          rx="8"
          fill={nodeColor}
          stroke={isSelected ? '#f59e0b' : (hasChildren ? '#60a5fa' : 'none')}
          strokeWidth={isSelected ? 3 : 1}
          cursor="pointer"
          onClick={() => setSelectedNode(node)}
          onDoubleClick={() => node.id !== 'root' && openEditModal(node)}
        />
        
        {isCurrent && progressPercent > 0 && progressPercent < 100 && (
          <rect
            x={node.x - 80}
            y={node.y + 30}
            width={160 * (progressPercent / 100)}
            height="3"
            fill="#fbbf24"
            rx="1"
          />
        )}

        {isParallel && parallelProgress > 0 && parallelProgress < 100 && (
          <rect
            x={node.x - 80}
            y={node.y + 30}
            width={160 * (parallelProgress / 100)}
            height="3"
            fill="#38bdf8"
            rx="1"
          />
        )}
        
        <text
          x={node.x}
          y={node.y + 10}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="12"
          fontWeight={isCurrent ? "bold" : (isDecision ? "bold" : "normal")}
          cursor="pointer"
          onClick={() => setSelectedNode(node)}
          onDoubleClick={() => node.id !== 'root' && openEditModal(node)}
        >
          {node.name.length > 18 ? node.name.slice(0, 15) + '...' : node.name}
        </text>
        
        {node.duration && node.duration.value > 0 && !isCurrent && (
          <text
            x={node.x + 35}
            y={node.y - 7}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="14"
            className="duration-badge"
          >
            ⏱️ {formatDuration(node.duration)}
          </text>
        )}
        
        {isCurrent && node.duration && node.duration.value > 0 && (
          <text
            x={node.x + 35}
            y={node.y - 7}
            textAnchor="middle"
            fill="#fbbf24"
            fontSize="14"
            className="duration-badge"
          >
            ⏱️ {formatDuration(node.duration)}
          </text>
        )}
        
        {node.startCondition?.rules?.length > 0 && (
          <text
            x={node.x - 15}
            y={node.y - 25}
            textAnchor="middle"
            fill="#f59e0b"
            fontSize="14"
          >
            ▶ {node.startCondition.rules[0].param?.split('.').pop()} {node.startCondition.rules[0].operator} {node.startCondition.rules[0].value}
          </text>
        )}
        
        {isDecision && !isStart && !isCompleted && !isCurrent && (
          <g>
            <circle
              cx={node.x + 85}
              cy={node.y - 15}
              r="10"
              fill="#f97316"
              stroke="white"
              strokeWidth="1.5"
            />
            <text
              x={node.x + 85}
              y={node.y - 12}
              textAnchor="middle"
              fill="white"
              fontSize="12"
              fontWeight="bold"
            >
              !
            </text>
          </g>
        )}
        
        {isSelected && !isMaxChildren && !isSimulationRunning && (
          <g
            cursor="pointer"
            onClick={(e) => {
              e.stopPropagation();
              openAddModal();
            }}
          >
            <circle
              cx={node.x + 85}
              cy={node.y - 15}
              r="12"
              fill="#10b981"
              stroke="white"
              strokeWidth="2"
            />
            <text
              x={node.x + 85}
              y={node.y - 12}
              textAnchor="middle"
              fill="white"
              fontSize="14"
              fontWeight="bold"
            >
              +
            </text>
          </g>
        )}
        
        {isSelected && isMaxChildren && (
          <text
            x={node.x - 65}
            y={node.y - 10}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="10"
          >
            max
          </text>
        )}
      </g>
    );
  }, [selectedNode, openAddModal, openEditModal, formatDuration, isDecisionNode, handleMouseEnter, handleMouseLeave, getNodeColor, currentNodeId, completedNodes, nodeStartTime, durationToMs, isSimulationRunning, parallelNodes]);

  // Рекурсивная отрисовка дерева
  const renderTreeNodes = useCallback((node) => {
    return (
      <g key={node.id}>
        {renderNode(node)}
        {node.children && node.children.map(child => renderTreeNodes(child))}
      </g>
    );
  }, [renderNode]);

  const handleSaveTree = () => {
    const json = JSON.stringify(treeData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'decision_tree.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleLoadTree = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = (e) => {
      document.body.removeChild(input);
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const loaded = JSON.parse(ev.target.result);
          if (!loaded.id || !loaded.type) throw new Error('Неверный формат');
          setTreeData(loaded);
          setSelectedNode(null);
          setCompletedNodes(new Set());
          setExecutionPath([]);
          setIsTreeCompleted(false);
        } catch {
          alert('Ошибка: файл не является деревом решений');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  // Модальное окно для добавления/редактирования
  const modalContent = useMemo(() => {
    if (!showModal) return null;
    
    return createPortal(
      <div className="modal-overlay" onClick={() => setShowModal(false)}>
        <div className="modal-content" onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <h3>{editingNode ? 'Редактировать узел' : 'Добавить действие'}</h3>
            <button className="close-btn" onClick={() => setShowModal(false)}>✕</button>
          </div>
          
          <div className="modal-body">
            <div className="form-group">
              <label>Название *</label>
              <input
                type="text"
                value={newNode.name}
                onChange={(e) => setNewNode(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Например: Эвакуация персонала"
                autoFocus
              />
            </div>
            
            <div className="form-group">
              <label>Ответственный</label>
              <input
                type="text"
                value={newNode.responsible}
                onChange={(e) => setNewNode(prev => ({ ...prev, responsible: e.target.value }))}
                placeholder="Например: Начальник смены"
              />
            </div>
            
            <div className="form-group">
              <label>Длительность</label>
              <div className="duration-input">
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={newNode.duration.value}
                  onChange={(e) => setNewNode(prev => ({
                    ...prev,
                    duration: { ...prev.duration, value: parseFloat(e.target.value) || 0 }
                  }))}
                />
                <select
                  value={newNode.duration.unit}
                  onChange={(e) => setNewNode(prev => ({
                    ...prev,
                    duration: { ...prev.duration, unit: e.target.value }
                  }))}
                >
                  <option value="sec">секунд</option>
                  <option value="min">минут</option>
                  <option value="hour">часов</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newNode.parallel || false}
                  onChange={(e) => setNewNode(prev => ({ ...prev, parallel: e.target.checked }))}
                />
                <span> Можно выполнять параллельно</span>
              </label>
              <small>Если включено, следующее действие начнётся через 10 сек не дожидаясь завершения этого</small>
            </div>

            <div className="form-group">
              <label>Условие для начала действия</label>
              {(newNode.startCondition?.rules || []).map((rule, idx) => (
                <div key={idx} className="condition-rule">
                  {idx > 0 && (
                    <select
                      value={rule.combinator}
                      onChange={(e) => setNewNode(prev => {
                        const rules = [...prev.startCondition.rules];
                        rules[idx] = { ...rules[idx], combinator: e.target.value };
                        return { ...prev, startCondition: { ...prev.startCondition, rules } };
                      })}
                      className="rule-combinator"
                    >
                      <option value="AND">AND</option>
                      <option value="OR">OR</option>
                    </select>
                  )}
                  <select
                    value={rule.param}
                    onChange={(e) => setNewNode(prev => {
                      const rules = [...prev.startCondition.rules];
                      rules[idx] = { ...rules[idx], param: e.target.value };
                      return { ...prev, startCondition: { ...prev.startCondition, rules } };
                    })}
                  >
                    <option value="">Выберите параметр</option>
                    {getAvailableParamsCombined().map(param => (
                      <option key={param.id} value={param.id}>{param.name}</option>
                    ))}
                  </select>
                  <select
                    value={rule.operator}
                    onChange={(e) => setNewNode(prev => {
                      const rules = [...prev.startCondition.rules];
                      rules[idx] = { ...rules[idx], operator: e.target.value };
                      return { ...prev, startCondition: { ...prev.startCondition, rules } };
                    })}
                  >
                    <option value=">">{'>'}</option>
                    <option value="<">{'<'}</option>
                    <option value="==">{'='}</option>
                    <option value="!=">{'≠'}</option>
                  </select>
                  <input
                    type="text"
                    value={rule.value}
                    onChange={(e) => setNewNode(prev => {
                      const rules = [...prev.startCondition.rules];
                      rules[idx] = { ...rules[idx], value: e.target.value };
                      return { ...prev, startCondition: { ...prev.startCondition, rules } };
                    })}
                    placeholder="значение"
                  />
                  <button
                    onClick={() => setNewNode(prev => ({
                      ...prev,
                      startCondition: {
                        ...prev.startCondition,
                        rules: prev.startCondition.rules.filter((_, i) => i !== idx)
                      }
                    }))}
                    className="remove-rule"
                  >✕</button>
                </div>
              ))}
              <button
                onClick={() => setNewNode(prev => ({
                  ...prev,
                  startCondition: {
                    ...prev.startCondition,
                    rules: [
                      ...(prev.startCondition?.rules || []),
                      { param: '', operator: '>', value: '', combinator: prev.startCondition?.rules?.length > 0 ? 'AND' : '' }
                    ]
                  }
                }))}
                className="add-rule"
              >+ Добавить условие</button>
            </div>

            <div className="form-group">
              <label>Условие выполнения (проверяется на протяжении всего действия)</label>
              {(newNode.executionCondition?.rules || []).map((rule, idx) => (
                <div key={idx} className="condition-rule">
                  {idx > 0 && (
                    <select
                      value={rule.combinator}
                      onChange={(e) => setNewNode(prev => {
                        const rules = [...prev.executionCondition.rules];
                        rules[idx] = { ...rules[idx], combinator: e.target.value };
                        return { ...prev, executionCondition: { ...prev.executionCondition, rules } };
                      })}
                      className="rule-combinator"
                    >
                      <option value="AND">AND</option>
                      <option value="OR">OR</option>
                    </select>
                  )}
                  <select
                    value={rule.param}
                    onChange={(e) => setNewNode(prev => {
                      const rules = [...prev.executionCondition.rules];
                      rules[idx] = { ...rules[idx], param: e.target.value };
                      return { ...prev, executionCondition: { ...prev.executionCondition, rules } };
                    })}
                  >
                    <option value="">Выберите параметр</option>
                    {getAvailableParamsCombined().map(param => (
                      <option key={param.id} value={param.id}>{param.name}</option>
                    ))}
                  </select>
                  <select
                    value={rule.operator}
                    onChange={(e) => setNewNode(prev => {
                      const rules = [...prev.executionCondition.rules];
                      rules[idx] = { ...rules[idx], operator: e.target.value };
                      return { ...prev, executionCondition: { ...prev.executionCondition, rules } };
                    })}
                  >
                    <option value=">">{'>'}</option>
                    <option value="<">{'<'}</option>
                    <option value="==">{'='}</option>
                    <option value="!=">{'≠'}</option>
                  </select>
                  <input
                    type="text"
                    value={rule.value}
                    onChange={(e) => setNewNode(prev => {
                      const rules = [...prev.executionCondition.rules];
                      rules[idx] = { ...rules[idx], value: e.target.value };
                      return { ...prev, executionCondition: { ...prev.executionCondition, rules } };
                    })}
                    placeholder="значение"
                  />
                  <button
                    onClick={() => setNewNode(prev => ({
                      ...prev,
                      executionCondition: {
                        ...prev.executionCondition,
                        rules: prev.executionCondition.rules.filter((_, i) => i !== idx)
                      }
                    }))}
                    className="remove-rule"
                  >✕</button>
                </div>
              ))}
              <button
                onClick={() => setNewNode(prev => ({
                  ...prev,
                  executionCondition: {
                    ...prev.executionCondition,
                    rules: [
                      ...(prev.executionCondition?.rules || []),
                      { param: '', operator: '>', value: '', combinator: prev.executionCondition?.rules?.length > 0 ? 'AND' : '' }
                    ]
                  }
                }))}
                className="add-rule"
              >+ Добавить условие</button>
            </div>

            <div className="form-group">
              <label>Действия над объектами карты при завершении</label>
              {(newNode.objectActions || []).map((action, idx) => {
                // Находим выбранный объект чтобы показать его свойства
                const selectedEl = elements?.find(e => e.id === action.objectId);
                const availableProps = selectedEl?.properties
                  ? Object.keys(selectedEl.properties)
                  : [];

                return (
                  <div key={idx} className="condition-rule">
                    <select
                      value={action.objectId}
                      onChange={(e) => setNewNode(prev => {
                        const actions = [...prev.objectActions];
                        actions[idx] = { ...actions[idx], objectId: e.target.value, property: '', value: '' };
                        return { ...prev, objectActions: actions };
                      })}
                    >
                      <option value="">Выберите объект</option>
                      {(elements || [])
                        .filter(e => e.type === 'object')
                        .map(e => (
                          <option key={e.id} value={e.id}>
                            {e.label || e.objectType || e.id}
                          </option>
                        ))}
                    </select>

                    <select
                      value={action.property}
                      disabled={!action.objectId}
                      onChange={(e) => setNewNode(prev => {
                        const actions = [...prev.objectActions];
                        actions[idx] = { ...actions[idx], property: e.target.value, value: '' };
                        return { ...prev, objectActions: actions };
                      })}
                    >
                      <option value="">Свойство</option>
                      {availableProps.map(prop => (
                        <option key={prop} value={prop}>{prop}</option>
                      ))}
                    </select>

                    <input
                      type="text"
                      value={String(action.value)}
                      disabled={!action.property}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const val = raw === 'true' ? true : raw === 'false' ? false : isNaN(raw) ? raw : Number(raw);
                        setNewNode(prev => {
                          const actions = [...prev.objectActions];
                          actions[idx] = { ...actions[idx], value: val };
                          return { ...prev, objectActions: actions };
                        });
                      }}
                      placeholder="значение"
                    />

                    <button
                      onClick={() => setNewNode(prev => ({
                        ...prev,
                        objectActions: prev.objectActions.filter((_, i) => i !== idx)
                      }))}
                      className="remove-rule"
                    >✕</button>
                  </div>
                );
              })}
              <button
                onClick={() => setNewNode(prev => ({
                  ...prev,
                  objectActions: [...(prev.objectActions || []), { objectId: '', property: '', value: '' }]
                }))}
                className="add-rule"
              >+ Добавить действие</button>
            </div>
            
            <div className="form-group">
              <label>Событие по окончании (опционально)</label>
              <input
                type="text"
                value={newNode.eventName}
                onChange={(e) => setNewNode(prev => ({ ...prev, eventName: e.target.value }))}
                placeholder="Например: Эвакуация завершена"
              />
            </div>
          </div>
          
          <div className="modal-footer">
            {editingNode && (
              <button className="btn-delete-modal" onClick={deleteNode}>
                Удалить
              </button>
            )}
            <button className="btn-save" onClick={saveNode}>
              {editingNode ? 'Сохранить' : 'Добавить'}
            </button>
            <button className="btn-cancel" onClick={() => setShowModal(false)}>
              Отмена
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }, [showModal, editingNode, newNode, getAvailableParamsCombined, addConditionRule, updateConditionRule, removeConditionRule, saveNode, deleteNode]);


  return (
    <div className="decision-tree">
      <div className="tree-header">
        <h3>Дерево принятия решений</h3>
        <div className="tree-controls">
          <span className="step-counter">Шаг: {currentStep}</span>
          <button className="tree-io-btn" onClick={handleSaveTree} title="Сохранить дерево">
            💾
          </button>
          <button className="tree-io-btn" onClick={handleLoadTree} title="Загрузить дерево">
            📂
          </button>
        </div>
      </div>

      <div className="tree-canvas-wrapper" ref={containerRef}>
        <svg className="tree-svg" width="100%" height="100%" viewBox="0 0 1000 600" preserveAspectRatio="xMidYMid meet">
          <g className="edges">
            {renderEdges(treeData)}
          </g>
          <g className="nodes">
            {renderTreeNodes(treeData)}
          </g>
        </svg>
        
        {tooltipNode && (
          <div 
            className="decision-tooltip"
            style={{
              position: 'absolute',
              left: tooltipPos.x,
              top: tooltipPos.y,
              transform: 'translateX(-50%)'
            }}
          >
            <div className="tooltip-content">
              <strong>⚡ Decision Node</strong>
              <p>У этого узла {tooltipNode.children?.length} вариантов выбора</p>
              <p>Во время моделирования выберите одну из ветвей для проверки:</p>
              <ul>
                {tooltipNode.children?.map((child, idx) => (
                  <li key={child.id}>{idx + 1}. {child.name}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
      
      {modalContent}
      {showDecisionPrompt && pendingDecisionNode && createPortal(
        <div className="modal-overlay decision-prompt-overlay" onClick={() => setShowDecisionPrompt(false)}>
          <div className="modal-content decision-prompt-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>⚡ Выбор ветви дерева решений</h3>
              <button className="close-btn" onClick={() => setShowDecisionPrompt(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p>Узел <strong>{pendingDecisionNode.name}</strong> имеет несколько вариантов действий.</p>
              <p>Выберите одну из ветвей для продолжения:</p>
              <div className="branch-list">
                {pendingDecisionNode.children?.map((child, idx) => (
                  <button
                    key={child.id}
                    className="branch-btn"
                    onClick={() => selectBranch(child)}
                  >
                    <span className="branch-number">{idx + 1}</span>
                    <span className="branch-name">{child.name}</span>
                    {child.duration?.value > 0 && (
                      <span className="branch-duration">⏱️ {formatDuration(child.duration)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DecisionTree;