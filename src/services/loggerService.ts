export class LoggerService {
  static log(message: string) {
    console.log(`[${new Date().toISOString()}] ${message}`);
  }
}
