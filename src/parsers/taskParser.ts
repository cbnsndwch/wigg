import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Task } from '../types';

export class MarkdownParser {
  static parse(filePath: string): Task[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const tasks: Task[] = [];
    const lines = content.split('\n');
    
    let taskId = 1;
    
    for (const line of lines) {
      // Match markdown task format: - [ ] task or - [x] task
      const match = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
      if (match) {
        const completed = match[1].toLowerCase() === 'x';
        const title = match[2].trim();
        
        tasks.push({
          id: `task-${taskId++}`,
          title,
          completed,
        });
      }
    }
    
    return tasks;
  }
}

export class YamlParser {
  static parse(filePath: string): Task[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = yaml.load(content) as any;
    
    if (!data.tasks || !Array.isArray(data.tasks)) {
      throw new Error('YAML file must contain a "tasks" array');
    }
    
    return data.tasks.map((task: any, index: number) => ({
      id: task.id || `task-${index + 1}`,
      title: task.title,
      description: task.description,
      completed: task.completed || false,
      parallelGroup: task.parallel_group || task.parallelGroup,
    }));
  }
}

export class TaskParser {
  static parse(filePath: string): Task[] {
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.md' || ext === '.markdown') {
      return MarkdownParser.parse(filePath);
    } else if (ext === '.yaml' || ext === '.yml') {
      return YamlParser.parse(filePath);
    } else {
      throw new Error(`Unsupported file format: ${ext}`);
    }
  }
  
  static createSingleTask(taskDescription: string): Task {
    return {
      id: 'task-1',
      title: taskDescription,
      completed: false,
    };
  }
}
