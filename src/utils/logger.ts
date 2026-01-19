import chalk from 'chalk';

export class Logger {
  constructor(private verbose: boolean = false) {}
  
  info(message: string): void {
    console.log(chalk.blue('ℹ'), message);
  }
  
  success(message: string): void {
    console.log(chalk.green('✓'), message);
  }
  
  error(message: string): void {
    console.log(chalk.red('✗'), message);
  }
  
  warning(message: string): void {
    console.log(chalk.yellow('⚠'), message);
  }
  
  debug(message: string): void {
    if (this.verbose) {
      console.log(chalk.gray('→'), message);
    }
  }
  
  task(taskTitle: string): void {
    console.log(chalk.cyan('→'), chalk.bold(taskTitle));
  }
  
  section(title: string): void {
    console.log('\n' + chalk.bold.underline(title));
  }
}
