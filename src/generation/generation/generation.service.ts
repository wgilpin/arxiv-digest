import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class GenerationService {
  private readonly genAI: GoogleGenerativeAI;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }
  /**
   * Extracts key concepts from the provided paper text using Gemini-2.5-flash.
   * @param paperText The text of the paper.
   * @returns A promise that resolves to an array of extracted concepts.
   */
  async extractConcepts(paperText: string): Promise<string[]> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const prompt = `
Analyze this academic paper and extract 8-12 key technical concepts that would be essential for understanding this paper. 

Focus on:
- Core algorithms, techniques, or methodologies
- Mathematical concepts or models
- Technical terms specific to the field
- Fundamental theories or principles
- Important data structures or architectures

IMPORTANT: Return ONLY a valid JSON array of strings. Do not include any markdown formatting, explanations, or code blocks. Just the raw JSON array.

Example format:
["Neural Networks", "Backpropagation", "Gradient Descent"]

Paper text:
${paperText.slice(0, 30000)} // Limit to avoid token limits
`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      // Try to parse JSON response (handle markdown code blocks)
      try {
        // Extract JSON from markdown code blocks if present
        let jsonString = response.trim();
        const jsonMatch = jsonString.match(
          /```(?:json)?\s*(\[[\s\S]*?\])\s*```/,
        );
        if (jsonMatch) {
          jsonString = jsonMatch[1];
        } else if (jsonString.startsWith('```') && jsonString.endsWith('```')) {
          // Remove code block markers
          jsonString = jsonString
            .slice(3, -3)
            .replace(/^json\s*/, '')
            .trim();
        }

        const concepts = JSON.parse(jsonString) as unknown[];
        if (Array.isArray(concepts) && concepts.length > 0) {
          return (concepts as string[]).slice(0, 12); // Limit to 12 concepts max
        }
      } catch (parseError) {
        console.error('Failed to parse concepts JSON:', parseError);
        console.error('Raw response:', response);
      }

      // Fallback: extract concepts from response text
      let extractedConcepts: string[] = [];

      // Try to find array-like content in the response
      const arrayMatch = response.match(/\[([\s\S]*?)\]/);
      if (arrayMatch) {
        const arrayContent = arrayMatch[1];
        extractedConcepts = arrayContent
          .split(/[,\n]/)
          .map((item) => item.replace(/["\s]/g, '').trim())
          .filter((item) => item.length > 2 && item.length < 50)
          .slice(0, 12);
      }

      // If that didn't work, extract from lines
      if (extractedConcepts.length === 0) {
        const lines = response
          .split('\n')
          .filter((line) => line.trim().length > 0);
        extractedConcepts = lines
          .map((line) =>
            line
              .replace(/^[-*•]\s*/, '')
              .replace(/["[],]/g, '')
              .trim(),
          )
          .filter((concept) => concept.length > 2 && concept.length < 50)
          .slice(0, 12);
      }

      return extractedConcepts.length > 0
        ? extractedConcepts
        : ['Machine Learning', 'Neural Networks', 'Deep Learning']; // Ultimate fallback
    } catch (error) {
      console.error('Error extracting concepts:', error);

      // Fallback concepts based on common research areas
      return [
        'Neural Networks',
        'Machine Learning',
        'Deep Learning',
        'Optimization',
        'Statistical Methods',
        'Data Analysis',
      ];
    }
  }

  /**
   * Generates comprehensive lesson content for a given concept using Gemini-2.5-flash.
   * @param concept The concept for which to generate lesson content.
   * @returns A promise that resolves to an object containing the lesson title and content.
   */
  async generateLessonContent(
    concept: string,
  ): Promise<{ title: string; content: string }> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const prompt = `
Create a comprehensive educational lesson about the concept: "${concept}"

The lesson should be suitable for someone learning this concept for the first time, but assume they have a basic technical background.

Please structure your response as follows:
TITLE: [A clear, engaging title for the lesson]

CONTENT:
[Write the lesson content in well-formatted Markdown. Include:]
- Clear definition and explanation of the concept
- Why this concept is important  
- Key principles or components
- Real-world applications or examples
- How it relates to other concepts in the field
- Common misconceptions or challenges
- Further learning resources

Use proper Markdown formatting:
- **Bold** for important terms and section headers
- *Italics* for emphasis
- \`code\` for technical terms
- Bullet points for lists
- Code blocks for examples
- ## for section headers

Make the content engaging, informative, and approximately 400-600 words.
`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      // Parse the structured response
      const titleMatch = response.match(/TITLE:\s*(.+)/i);
      const contentMatch = response.match(/CONTENT:\s*([\s\S]+)/i);

      const title = titleMatch
        ? titleMatch[1].trim()
        : `Understanding ${concept}`;

      const content = contentMatch ? contentMatch[1].trim() : response; // Use full response as content if parsing fails

      const processedContent = this.escapeLatexInMath(content);

      return {
        title,
        content:
          processedContent ||
          `This lesson covers the fundamental concepts and applications of ${concept}. It provides a comprehensive introduction to help you understand this important topic in the field.`,
      };
    } catch (error) {
      console.error(`Error generating lesson content for ${concept}:`, error);

      // Fallback content
      return {
        title: `Introduction to ${concept}`,
        content: `This lesson provides an introduction to ${concept}, covering its key principles, applications, and importance in the field. Understanding ${concept} is essential for grasping more advanced topics and practical applications in this domain.`,
      };
    }
  }

  private escapeLatexInMath(text: string): string {
    if (!text) {
      return '';
    }
    // This function escapes backslashes within LaTeX delimiters ($...$ and $$...$$)
    // to prevent markdown processors from interfering with LaTeX commands.
    let result = text.replace(
      /\$(.*?)\$/g,
      (match: string, content: string) => {
        return `$${content.replace(/\\/g, '\\\\')}$`;
      },
    );
    result = result.replace(
      /\$\$(.*?)\$\$/gs,
      (match: string, content: string) => {
        return `$$${content.replace(/\\/g, '\\\\')}$$`;
      },
    );
    return result;
  }
}
