import * as fs from 'fs';
import * as path from 'path';

export class TemplateHelper {
  static renderTemplate(
    templatePath: string,
    variables: Record<string, any> = {},
  ): string {
    const fullPath = path.join(__dirname, templatePath);
    let template = fs.readFileSync(fullPath, 'utf-8');

    // Simple variable replacement
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      template = template.replace(regex, String(value));
    }

    return template;
  }
}
