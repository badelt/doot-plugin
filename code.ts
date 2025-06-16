// --- Plugin Initialization ---
figma.showUI(__html__, { width: 320, height: 600 });
figma.ui.once("message", (msg) => {
  if (msg.type === "ui-ready") {
    figma.ui.postMessage({ type: "focus-task-input" });
  }
});

// Define the structure of a single to-do task
interface Task {
  text: string;
  completed: boolean;
  nodeId: string | null;
  pageId: string | null;
  createdAt: number;
}

// --- Helper function to find the parent Page of any node ---
function findParentPage(node: SceneNode): PageNode | null {
  let parent = node.parent;
  while (parent && parent.type !== 'PAGE') {
    parent = parent.parent;
  }
  return parent && parent.type === 'PAGE' ? parent : null;
}

// --- Helper function to check if a node is a SceneNode ---
function isSceneNode(node: BaseNode): node is SceneNode {
  return "x" in node && "y" in node;
}

// A function to send the current selection details to the UI
const sendSelection = () => {
  if (figma.currentPage.selection.length === 1) {
    const selectedNode = figma.currentPage.selection[0];
    const parentPage = findParentPage(selectedNode);
    if (parentPage) {
      figma.ui.postMessage({ type: 'selection-changed', nodeId: selectedNode.id, pageId: parentPage.id });
    }
  } else {
    // If nothing or multiple things are selected, clear the link
    figma.ui.postMessage({ type: 'selection-changed', nodeId: null, pageId: null });
  }
};

// Listen for selection changes while the plugin is open
figma.on('selectionchange', () => {
  sendSelection();
});


// --- Data Storage Functions ---
function loadTasks(): Task[] {
  const data = figma.root.getPluginData('tasks');
  if (data) {
    const tasks: Task[] = JSON.parse(data);
    tasks.sort((a: Task, b: Task) => Number(a.completed) - Number(b.completed));
    return tasks;
  }
  return [];
}

function saveTasks(tasks: Task[]) {
  figma.root.setPluginData('tasks', JSON.stringify(tasks));
}

function sendTasksToUI() {
  const tasks = loadTasks();
  figma.ui.postMessage({ type: 'render-tasks', tasks: tasks });
}

// --- Main Message Handler ---
figma.ui.onmessage = async (msg) => {
  // Load saved todos from shared file storage
  if (msg.type === "get-todos") {
    const saved = figma.root.getPluginData("todos");
    const todos = saved ? JSON.parse(saved) : [];
    figma.ui.postMessage({ type: "load-todos", todos });
  }

  // Save todos to shared file storage
  if (msg.type === "save-todos") {
    await figma.root.setPluginData("todos", JSON.stringify(msg.todos));
  }
  if (msg.type === 'ui-ready') {
    sendTasksToUI(); // No argument needed now
    // Check if the plugin was launched by the shortcut and send the initial selection
    if (figma.command === 'create-todo') {
      sendSelection();
    } else {
      sendSelection(); // Also send selection on normal open
    }
  }
  if (msg.type === 'add-task') {
    const tasks = loadTasks();
    tasks.push({ text: msg.text, completed: false, nodeId: msg.nodeId, pageId: msg.pageId, createdAt: Date.now() });
    saveTasks(tasks);
    sendTasksToUI(); // No argument needed now
  }
  if (msg.type === 'toggle-task') {
    const tasks = loadTasks();
    // This is a safer way to find the task based on the index from the UI
    if (tasks[msg.index]) {
      const activeTasksBeforeToggle = tasks.filter(t => !t.completed).length;
      const isFinishingLastTask = activeTasksBeforeToggle === 1 && !tasks[msg.index].completed;

      tasks[msg.index].completed = !tasks[msg.index].completed;

      saveTasks(tasks);
      sendTasksToUI();

      if (isFinishingLastTask) {
        setTimeout(() => {
          figma.ui.postMessage({ type: 'trigger-confetti' });
        }, 800);
      }
    }
  }
  if (msg.type === 'delete-task') {
    const tasks = loadTasks();
    tasks.splice(msg.index, 1);
    saveTasks(tasks);
    sendTasksToUI(); // No argument needed now
  }
  if (msg.type === 'clear-completed') {
    let tasks = loadTasks();
    let incompleteTasks = tasks.filter(task => !task.completed);
    saveTasks(incompleteTasks);
    sendTasksToUI(); // No argument needed now
  }
  if (msg.type === 'resort-tasks') {
    let tasks = loadTasks(); // Load all tasks
    const sortPreference = msg.direction;

    tasks.sort((a: Task, b: Task) => {
      // Completed tasks always go to the bottom
      if (a.completed !== b.completed) {
        return Number(a.completed) - Number(b.completed);
      }
      // If both are incomplete, sort by date
      if (!a.completed && !b.completed) {
        // Ensure createdAt exists before sorting
        if (a.createdAt && b.createdAt) {
          return sortPreference === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt;
        }
      }
      return 0; // Keep original order for completed items or if dates are missing
    });

    saveTasks(tasks); // Save the new order
    sendTasksToUI(); // No argument needed now
  }
  if (msg.type === 'navigate-to-node') {
    if (!msg.pageId || !msg.nodeId) return;
    const page = figma.getNodeById(msg.pageId);
    if (!page || page.type !== 'PAGE') {
      figma.notify("Could not find the page this task was created on.", { error: true });
      return;
    }

    figma.currentPage = page;

    const node = figma.getNodeById(msg.nodeId);
    if (node && isSceneNode(node)) {
      figma.viewport.scrollAndZoomIntoView([node]);
      figma.currentPage.selection = [node];
    } else {
      figma.notify("Could not find the linked layer. It may have been deleted.", { error: true });
    }
  }
};