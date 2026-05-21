// projectManager.js
// Сохранение и загрузка проекта моделирования
// Формат: JSON с расширением .simproject

const PROJECT_VERSION = '1.0';

/**
 * Собирает снимок проекта из текущего состояния MapCanvas.
 *
 * @param {object} params
 * @param {Array}  params.elements          — все элементы карты (объекты, события, область, точка начала)
 * @param {object|null} params.simulationArea — полигон области моделирования
 * @param {object|null} params.startPoint    — точка начала моделирования
 * @param {object}      params.simulationConfig — { maxIterations, numRuns, environmentParams, environmentParamRanges, areaSize }
 * @param {object|null} params.selectedProcess  — выбранный процесс (обёртка с .id, .name, .icon, .process, .source)
 * @param {string|null} params.imageDataUrl    — base64 фонового изображения (может быть null)
 * @returns {object} projectSnapshot
 */
export function buildProjectSnapshot({
  elements,
  simulationArea,
  startPoint,
  simulationConfig,
  selectedProcess,
  imageDataUrl = null,
}) {
  // Сериализуем процесс — сохраняем только данные, не функции
  const processSnapshot = selectedProcess
    ? serializeProcess(selectedProcess)
    : null;

  // Фильтруем элементы — область и точка начала хранятся отдельно,
  // но их тоже сохраняем в elements для полноты
  const elementsSnapshot = elements.map(serializeElement);

  return {
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    process: processSnapshot,
    simulationConfig: {
      maxIterations: simulationConfig.maxIterations ?? 150,
      numRuns: simulationConfig.numRuns ?? 1,
      environmentParams: simulationConfig.environmentParams ?? {},
      environmentParamRanges: simulationConfig.environmentParamRanges ?? {},
      areaSize: simulationConfig.areaSize ?? null,
    },
    elements: elementsSnapshot,
    simulationArea: simulationArea ?? null,
    startPoint: startPoint ?? null,
    // Изображение опционально — может быть большим,
    // пользователь загрузит его сам при необходимости
    backgroundImage: imageDataUrl ?? null,
  };
}

/**
 * Скачивает снимок проекта как .simproject файл.
 *
 * @param {object} snapshot — результат buildProjectSnapshot()
 * @param {string} [filename] — имя файла без расширения
 */
export function downloadProject(snapshot, filename = 'project') {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(filename)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Точка входа: собирает снимок и сразу скачивает файл.
 */
export function saveProject(params, filename) {
  const snapshot = buildProjectSnapshot(params);
  downloadProject(snapshot, filename);
  return snapshot;
}

/**
 * Открывает диалог выбора файла и возвращает Promise с распакованным проектом.
 *
 * @returns {Promise<object>} — результат parseProjectFile()
 */
export function openProjectFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return reject(new Error('Файл не выбран'));
      // Дополнительная проверка расширения на случай если браузер пропустил другой файл
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext !== 'json') {
        return reject(new Error('Выберите файл проекта (.json)'));
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const result = parseProjectFile(ev.target.result);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Ошибка чтения файла'));
      reader.readAsText(file);
    };

    input.click();
  });
}

/**
 * Парсит JSON-строку файла проекта и возвращает готовые к использованию данные.
 *
 * @param {string} jsonString
 * @returns {{
 *   elements: Array,
 *   simulationArea: object|null,
 *   startPoint: object|null,
 *   simulationConfig: object,
 *   process: object|null,      // обёртка для selectedProcess
 *   backgroundImage: string|null,
 *   savedAt: string,
 *   version: string,
 * }}
 */
export function parseProjectFile(jsonString) {
  let raw;
  try {
    raw = JSON.parse(jsonString);
  } catch {
    throw new Error('Файл повреждён или не является файлом проекта');
  }

  if (!raw.version) {
    throw new Error('Неизвестный формат файла');
  }

  // Десериализуем элементы
  const elements = (raw.elements ?? []).map(deserializeElement);

  const process = raw.process ? deserializeProcess(raw.process) : null;

  return {
    version: raw.version,
    savedAt: raw.savedAt,
    elements,
    simulationArea: raw.simulationArea ?? null,
    startPoint: raw.startPoint ?? null,
    simulationConfig: {
      maxIterations: raw.simulationConfig?.maxIterations ?? 150,
      numRuns: raw.simulationConfig?.numRuns ?? 1,
      environmentParams: raw.simulationConfig?.environmentParams ?? {},
      environmentParamRanges: raw.simulationConfig?.environmentParamRanges ?? {},
      areaSize: raw.simulationConfig?.areaSize ?? null,
    },
    process,
    backgroundImage: raw.backgroundImage ?? null,
  };
}

/**
 * Сериализует один элемент карты.
 * Все поля копируются как есть — они уже plain-объекты.
 */
function serializeElement(el) {
  // Полное глубокое копирование — элементы не содержат функций
  return JSON.parse(JSON.stringify(el));
}

function deserializeElement(raw) {
  // При необходимости здесь можно мигрировать старые форматы
  return raw;
}

/**
 * Сериализует процесс.
 * Функции (spreadRule, getCellColor, и т.д.) не сохраняются —
 * они определены в исходных файлах процессов.
 * При загрузке стандартные процессы восстанавливаются по id,
 * пользовательские — только их данные (параметры, типы объектов и т.д.).
 */
function serializeProcess(processWrapper) {
  const { id, name, icon, source, process } = processWrapper;

  // Извлекаем из process только сериализуемые поля
  const processData = process
    ? serializeProcessData(process)
    : serializeProcessData(processWrapper); // если process — это сам объект

  return {
    id,
    name,
    icon,
    source: source ?? 'default',
    processData, // данные без функций
  };
}

function serializeProcessData(proc) {
  // Копируем всё кроме функций
  const result = {};
  for (const [key, value] of Object.entries(proc)) {
    if (typeof value !== 'function') {
      try {
        result[key] = JSON.parse(JSON.stringify(value));
      } catch {
        // Пропускаем несериализуемые поля (циклические ссылки и т.п.)
        console.warn(`[projectManager] Поле "${key}" не может быть сохранено`);
      }
    }
  }
  return result;
}

/**
 * Десериализует процесс обратно в структуру обёртки.
 *
 * Возвращаем структуру, совместимую с selectedProcess.
 */
function deserializeProcess(raw) {
  return {
    id: raw.id,
    name: raw.name,
    icon: raw.icon ?? '⚙️',
    source: raw.source ?? 'default',
    processData: raw.processData ?? {},
    _needsRelink: true, // флаг для MapCanvas: нужно переподвязать функции
  };
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Zа-яА-Я0-9_\- ]/g, '_').trim() || 'project';
}

/**
 *
 * @param {object} deserializedProcess — результат parseProjectFile().process
 * @param {Array}  availableProcesses  — текущий список availableProcesses в MapCanvas
 * @returns {object|null} — готовый selectedProcess или null если не удалось
 */
export function relinkProcess(deserializedProcess, availableProcesses) {
  if (!deserializedProcess) return null;

  if (deserializedProcess.source === 'default') {
    // Ищем стандартный процесс по id
    const found = availableProcesses.find(p => p.id === deserializedProcess.id);
    if (found) return found;

    console.warn(
      `[projectManager] Стандартный процесс "${deserializedProcess.id}" не найден в availableProcesses`
    );
    return null;
  }

  // Пользовательский процесс — функции потеряны, возвращаем частичный объект
  return {
    id: deserializedProcess.id,
    name: deserializedProcess.name,
    icon: deserializedProcess.icon,
    source: 'user',
    process: deserializedProcess.processData, // данные без функций
    _functionsLost: true,
  };
}