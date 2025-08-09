import * as fs from 'fs';
import * as path from 'path';

export class TemplateHelper {
  static renderTemplate(
    templatePath: string,
    variables: Record<string, any> = {},
  ): string {
    // In development, load templates from src directory
    const isDevelopment = process.env.NODE_ENV !== 'production';
    const baseDir = isDevelopment 
      ? path.join(process.cwd(), 'src', 'templates')
      : path.join(process.cwd(), 'dist', 'templates');
    const fullPath = path.join(baseDir, templatePath);
    let template = fs.readFileSync(fullPath, 'utf-8');

    // Load and inject common components
    const navbar = this.loadComponent('navbar.html');
    const authModal = this.loadComponent('auth-modal.html');
    const authConfig = this.loadComponent('auth-config.html');

    // Add common components to variables
    const allVariables = {
      ...variables,
      NAVBAR: navbar,
      AUTH_MODAL: authModal,
      AUTH_CONFIG: authConfig,
    };

    // Simple variable replacement
    for (const [key, value] of Object.entries(allVariables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      template = template.replace(regex, String(value));
    }

    return template;
  }

  private static loadComponent(componentPath: string, variables: Record<string, any> = {}): string {
    try {
      // In development, load templates from src directory
      const isDevelopment = process.env.NODE_ENV !== 'production';
      const baseDir = isDevelopment 
        ? path.join(process.cwd(), 'src', 'templates')
        : path.join(process.cwd(), 'dist', 'templates');
      const fullPath = path.join(baseDir, componentPath);
      let component = fs.readFileSync(fullPath, 'utf-8');

      // Replace variables in component
      for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        component = component.replace(regex, String(value));
      }

      return component;
    } catch (error) {
      console.warn(`Could not load component ${componentPath}:`, error);
      return '';
    }
  }
}
