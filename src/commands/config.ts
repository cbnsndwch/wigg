import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';

export class InitCommand {
  static async execute(): Promise<void> {
    const logger = new Logger();
    const configManager = new ConfigManager();
    
    if (configManager.exists()) {
      logger.warning('Configuration already exists at .wigg/config.yaml');
      return;
    }
    
    logger.info('Initializing wigg configuration...');
    const config = configManager.init();
    
    logger.success('Configuration created at .wigg/config.yaml');
    logger.info('\nDetected settings:');
    logger.info(`  Project: ${config.project.name}`);
    if (config.project.language) {
      logger.info(`  Language: ${config.project.language}`);
    }
    if (config.project.framework) {
      logger.info(`  Framework: ${config.project.framework}`);
    }
  }
}

export class ConfigCommand {
  static async execute(): Promise<void> {
    const logger = new Logger();
    const configManager = new ConfigManager();
    
    if (!configManager.exists()) {
      logger.error('No configuration found. Run "wigg --init" to create one.');
      return;
    }
    
    const config = configManager.load();
    if (!config) {
      logger.error('Failed to load configuration');
      return;
    }
    
    logger.section('Current Configuration');
    console.log(JSON.stringify(config, null, 2));
  }
}

export class AddRuleCommand {
  static async execute(rule: string): Promise<void> {
    const logger = new Logger();
    const configManager = new ConfigManager();
    
    if (!configManager.exists()) {
      logger.info('No configuration found. Creating default configuration...');
      configManager.init();
    }
    
    configManager.addRule(rule);
    logger.success(`Rule added: ${rule}`);
  }
}
