# Инструмент имитационного моделирования и визуализации процессов принятия решений в условиях неопределённости

Позволяет строить план реагирования в виде дерева решений, запускать имитационную модель развития процесса (пожар, наводнение и др.) и в реальном времени наблюдать за распространением опасного фактора на интерактивной карте. По ходу моделирования события из симуляции и действия из плана реагирования автоматически фиксируются в журнале и отображаются на единой временной шкале — с причинно-следственными связями, состояниями объектов и историей всех запусков.

<b> Выполнил: Дерезовский Илья Денисович</b>, группа МСПИН241

## Аннотация

Выпускная квалификационная работа посвящена разработке веб-приложения для имитационного моделирования и визуализации процессов принятия решений в условиях неопределённости. Актуальность темы обусловлена необходимостью анализа эффективности планов реагирования на чрезвычайные ситуации, которые характеризуются многовариантностью развития событий, вероятностным характером исходов и взаимосвязанностью параллельных процессов. Существующие программные инструменты, как показал проведённый анализ, либо ориентированы на отдельные аспекты моделирования, либо не обеспечивают наглядного представления причинно-следственных связей между управленческими решениями, возникающими событиями и изменениями состояния объектов. В работе представлен новый метод визуализации процессов принятия решений в условиях неопределённости, объединяющий в едином временном представлении три взаимосвязанных компонента: действия из плана реагирования, события, возникающие в ходе имитационного моделирования, и состояния объектов моделируемой среды. Ключевой особенностью метода является явное отображение причинно-следственных связей. Практическое тестирование системы на сценарии пожара на складе с участием двух специалистов продемонстрировало, что инструмент позволяет выявлять условия, при которых одна стратегия реагирования оказывается предпочтительнее другой, а также анализировать устойчивость планов к изменениям параметров окружающей среды.

## Annotation

The final thesis is devoted to the development of a web application for simulation and visualization of decision-making processes in conditions of uncertainty. The relevance of the topic is due to the need to analyze the effectiveness of emergency response plans, which are characterized by the multivariate nature of events, the probabilistic nature of outcomes and the interconnectedness of parallel processes. The existing software tools, as the analysis has shown, are either focused on certain aspects of modeling, or do not provide a visual representation of the cause-and-effect relationships between management decisions, emerging events and changes in the state of facilities. The paper presents a new method for visualizing decision-making processes in conditions of uncertainty, combining three interrelated components in a single time representation: actions from the response plan, events occurring during simulation, and the state of objects in the simulated environment. The key feature of the method is the explicit display of cause-effect relationships. Practical testing of the system in a warehouse fire scenario with the participation of two specialists demonstrated that the tool allows to identify conditions under which one response strategy is preferable to another, as well as analyze the resilience of plans to changes in environmental parameters.

## Запуск

### `cd <path-to-decision-simulation-tool-main> && npm install && npm start`

Приложение откроется на http://localhost:3000.

## Структура проекта

```bash
src/
├── components/
│   ├── Analytics/
│   │   ├── EventLogger.js          # Сбор, хранение и экспорт журнала событий в CSV
│   │   ├── ReportModal.jsx         # Отчёт с ранжированием запусков и весовыми коэффициентами
│   │   └── ReportModal.css
│   │
│   ├── DecisionTree/
│   │   ├── DecisionTree.jsx        # Интерактивное дерево принятия решений (SVG)
│   │   └── DecisionTree.css
│   │
│   ├── MapCanvas/
│   │   ├── MapCanvas.jsx           # Пространственная визуализация: карта, объекты, зоны
│   │   ├── MapCanvas.css
│   │   ├── simulationEngine.js     # Ядро моделирования: шаг клеточного автомата, события
│   │   ├── SimulationControls.jsx  # Панель управления запуском моделирования
│   │   ├── SimulationSetupModal.js # Настройка параметров среды и числа запусков
│   │   ├── projectManager.js       # Сохранение и загрузка проектов
│   │   └── processValidator.js     # Валидация пользовательских моделей процессов
│   │
│   └── TimelineVisualization/
│       ├── TimelineVisualization.jsx  # Аналитическая диаграмма: ось времени, действия, объекты
│       └── TimelineVisualization.css
│
├── user_processes/                 # Подключаемые модели процессов (можно добавлять свои)
│   ├── fireProcess.js              # Модель распространения пожара
│   ├── floodProcess.js             # Модель наводнения
│   ├── warehouseFireProcess.js     # Модель пожара на складе с системой тушения
│   └── processTemplate.js         # Шаблон для создания новой модели процесса
│
├── App.js                          # Корневой компонент, синхронизация всех модулей
├── App.css
└── App.test.js
```

## Стек технологий

| Категория | Технология |
|---|---|
| UI-фреймворк | React 19.2.4 |
| Графика и карта | Konva.js, react-konva |
| Диаграммы | SVG (нативный, без библиотек) |
| Стили | CSS Variables, CSS Modules |
| Моделирование | Клеточный автомат (собственная реализация) |
| Хранение данных | localStorage, in-memory (без внешней БД) |
| Экспорт данных | CSV (Blob API) |
| Сборка | Create React App |
| Язык | JavaScript (ES2020+), JSX |
