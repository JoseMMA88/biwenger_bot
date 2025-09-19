import chalk from 'chalk';

export const Logger = {
  info: (msg) => console.log(chalk.blue('[INFO]'), msg),
  success: (msg) => console.log(chalk.green('✅ [OK]'), msg),
  warn: (msg) => console.log(chalk.yellow('⚠️ [WARN]'), msg),
  error: (msg) => console.log(chalk.red('❌ [ERROR]'), msg),
  skip: (player, reason) =>
    console.log(chalk.gray(`🛑 [SKIP] ${player}`), chalk.dim(reason)),
  section: (title) => console.log(chalk.cyan.bold(`\n--- ${title} ---`)),
  inc: (value) => {
    if (value > 0) {
      return chalk.green(`▲${value}`);
    } else if (value < 0) {
      return chalk.red(`▼${value}`);
    } else {
      return chalk.gray(`•${value}`);
    }
  }
};