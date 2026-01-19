import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { ProjectConfig } from '../types';

const CONFIG_DIR = '.wigg';
const CONFIG_FILE = 'config.yaml';

export class ConfigManager {
  private configPath: string;
  
  constructor(projectRoot: string = process.cwd()) {
    this.configPath = path.join(projectRoot, CONFIG_DIR, CONFIG_FILE);
  }
  
  exists(): boolean {
    return fs.existsSync(this.configPath);
  }
  
  load(): ProjectConfig | null {
    if (!this.exists()) {
      return null;
    }
    
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      return yaml.load(content) as ProjectConfig;
    } catch (error) {
      console.error('Failed to load config:', error);
      return null;
    }
  }
  
  save(config: ProjectConfig): void {
    const dir = path.dirname(this.configPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    const content = yaml.dump(config);
    fs.writeFileSync(this.configPath, content, 'utf-8');
  }
  
  addRule(rule: string): void {
    const config = this.load() || this.createDefault();
    
    if (!config.rules) {
      config.rules = [];
    }
    
    if (!config.rules.includes(rule)) {
      config.rules.push(rule);
      this.save(config);
    }
  }
  
  createDefault(): ProjectConfig {
    const projectRoot = process.cwd();
    const packageJsonPath = path.join(projectRoot, 'package.json');
    let projectName = 'my-project';
    let language: string | undefined;
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        projectName = pkg.name || projectName;
        
        // Detect language/framework from dependencies
        if (pkg.dependencies) {
          if (pkg.dependencies.react || pkg.dependencies['@types/react']) {
            language = 'TypeScript';
          } else if (pkg.dependencies.typescript) {
            language = 'TypeScript';
          } else {
            language = 'JavaScript';
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }
    
    return {
      project: {
        name: projectName,
        language,
      },
      commands: {
        test: 'npm test',
        lint: 'npm run lint',
        build: 'npm run build',
      },
      rules: [],
      boundaries: {
        neverTouch: ['node_modules/**', '*.lock', 'dist/**'],
      },
    };
  }
  
  init(): ProjectConfig {
    const config = this.createDefault();
    this.save(config);
    return config;
  }
}
