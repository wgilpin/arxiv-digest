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
        generationConfig: {
          responseMimeType: 'application/json',
        },
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

        // Normalize quotes to handle smart quotes from AI models
        jsonString = jsonString
          .replace(/[“”]/g, '"') // Convert smart quotes to straight quotes
          .replace(/[‘’]/g, "'"); // Convert smart single quotes too

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
      const arrayMatch = response.match(/\b\[([\s\S]*?)\]\b/);
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
   * Generates a list of lesson topics for a given concept, breaking it down into 2-3 minute lessons.
   * @param concept The concept to break down into lesson topics.
   * @returns A promise that resolves to an array of lesson topic strings.
   */
  async generateLessonTopics(concept: string): Promise<string[]> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const prompt = `
Break down the concept "${concept}" into 3-5 specific lesson topics that can each be taught in 2-3 minutes.

Each lesson should focus on a specific sub-topic or aspect of the main concept. Think of how you would structure a short video series or tutorial sequence.

Requirements:
- Each lesson should be focused on 1-2 specific aspects
- Content should be digestible in 2-3 minutes of reading
- Topics should build logically on each other
- Avoid overlap between lessons
- Make topics specific and actionable

IMPORTANT: Return ONLY a valid JSON array of strings. Do not include any markdown formatting, explanations, or code blocks. Just the raw JSON array.

Example format:
["Introduction and Definition", "Core Principles", "Implementation Details", "Common Applications", "Best Practices"]

Concept: ${concept}
`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        // Attempt to extract JSON array from the response
        const jsonMatch = response.match(/(\[[\s\S]*?\])/);
        if (jsonMatch) {
          const jsonString = jsonMatch[0];
          try {
            const topics = JSON.parse(jsonString) as unknown[];
            if (Array.isArray(topics) && topics.length > 0) {
              return (topics as string[]).slice(0, 5);
            }
          } catch (e) {
            console.error('Initial JSON.parse failed:', e.message);
            console.error('Raw jsonString:', jsonString);
            
            // Try multiple cleanup strategies for escaped quotes and malformed JSON
            const cleanupStrategies = [
              // Strategy 1: Handle escaped quotes within strings
              (str: string) => str.replace(/\\"/g, '"'),
              
              // Strategy 2: Fix double-escaped quotes
              (str: string) => str.replace(/\\\\"/g, '\\"'),
              
              // Strategy 3: Handle unescaped quotes within strings by escaping them
              (str: string) => {
                // This handles cases like: "Understanding the "Fair Game" Core of Martingales"
                // We need to escape the inner quotes
                let result = str;
                
                // Find array elements and fix quotes within each element
                result = result.replace(/"([^"]*?"[^"]*?"[^"]*)"/g, (match, content) => {
                  // If content contains unescaped quotes, escape them
                  const escapedContent = content.replace(/"/g, '\\"');
                  return `"${escapedContent}"`;
                });
                
                // Also handle simpler cases with just one pair of inner quotes
                result = result.replace(/"([^"]*)"([^"]*)"([^"]*)"/g, '"$1\\"$2\\"$3"');
                
                return result;
              },
              
              // Strategy 4: Handle truncated JSON arrays
              (str: string) => {
                let result = str.trim();
                
                // If the string doesn't end with ], try to fix it
                if (!result.endsWith(']')) {
                  // If it ends with a quote, add the closing bracket
                  if (result.endsWith('"')) {
                    result += ']';
                  }
                  // If it doesn't end with a quote, add quote and bracket
                  else if (!result.endsWith('"]')) {
                    result += '"]';
                  }
                }
                
                return result;
              },
              
              // Strategy 5: Basic cleanup
              (str: string) => str
                .replace(/\n/g, '')
                .replace(/,\s*\]/g, ']')
                .replace(/,\s*}/g, '}')
            ];

            for (let i = 0; i < cleanupStrategies.length; i++) {
              try {
                let cleanedString = jsonString;
                // Apply all strategies up to current one
                for (let j = 0; j <= i; j++) {
                  cleanedString = cleanupStrategies[j](cleanedString);
                }
                
                console.log(`Trying cleanup strategy ${i + 1}:`, cleanedString);
                const topics = JSON.parse(cleanedString) as unknown[];
                if (Array.isArray(topics) && topics.length > 0) {
                  console.log('Successfully parsed with strategy', i + 1);
                  return (topics as string[]).slice(0, 5);
                }
              } catch (e2) {
                console.log(`Cleanup strategy ${i + 1} failed:`, e2.message);
              }
            }
            
            console.error('All cleanup strategies failed. Falling back to text extraction.');
          }
        }

        // Fallback to extracting content from lines if JSON parsing fails
        const lines = response
          .split('\n')
          .map((line) => line.trim())
          .filter(
            (line) =>
              line.length > 0 &&
              !line.startsWith('```') &&
              !line.toLowerCase().includes('json'),
          );

        const topics = lines
          .map((line) =>
            line
              .replace(/^["\d\-*•\[\],]+/, '')              
              .replace(/["\],]+$/, '')              
              .trim(),
          )
          .filter((topic) => topic.length > 5 && topic.length < 100);

        if (topics.length > 0) {
          return topics.slice(0, 5);
        }
      } catch (parseError) {
        console.error('Failed to parse lesson topics JSON:', parseError);
        console.error('Raw response was:', response);
      }

      // Ultimate fallback
      return [
        `Introduction to ${concept}`,
        `Core Principles of ${concept}`,
        `Applications of ${concept}`,
      ];
    } catch (error) {
      console.error(`Error generating lesson topics for ${concept}:`, error);
      return [
        `Introduction to ${concept}`,
        `Understanding ${concept}`,
        `Practical Applications`,
      ];
    }
  }

  private generateFocusedLessonPrompt(concept: string, topic: string): string {
    return `
Create a focused educational lesson about the topic: "${topic}" (part of the broader concept: "${concept}")

The lesson should be suitable for someone learning this topic for the first time, but assume they have a basic technical background.

IMPORTANT: This lesson should be focused, concise, and readable in 2-3 minutes. Focus ONLY on the specific topic provided, not the entire concept.

Please structure your response as follows:
TITLE: [A clear, engaging title for the lesson]

CONTENT:
[Write the lesson content in well-formatted Markdown. For this focused lesson, include:]
- Clear definition/explanation of this specific topic
- Why this topic matters within the broader concept
- Key points or principles for this topic
- Brief practical example or application
- How this topic connects to the overall concept

Use proper Markdown formatting:
- **Bold** for important terms and section headers
- *Italics* for emphasis
- \`code\` for technical terms, variables, and mathematical notation
- Bullet points for lists
- Code blocks for examples
- ## for section headers

Make the content engaging, informative, and approximately 200-350 words (2-3 minute read).
`;
  }

  private generateComprehensiveLessonPrompt(concept: string): string {
    return `
Create a comprehensive educational lesson about the concept: "${concept}"

The lesson should be suitable for someone learning this concept for the first first time, but assume they have a basic technical background.

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
- \`code\` for technical terms, variables, and mathematical notation
- Bullet points for lists
- Code blocks for examples
- ## for section headers

Make the content engaging, informative, and approximately 400-600 words.
`;
  }

  /**
   * Generates focused lesson content for a specific topic, designed for 2-3 minute reading.
   * @param concept The main concept this lesson belongs to.
   * @param topic The specific topic for this lesson.
   * @returns A promise that resolves to an object containing the lesson title and content.
   */
  async generateLessonContent(
    concept: string,
    topic?: string,
  ): Promise<{ title: string; content: string }> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const prompt = topic
        ? this.generateFocusedLessonPrompt(concept, topic)
        : this.generateComprehensiveLessonPrompt(concept);

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      // Parse the structured response
      const titleMatch = response.match(/TITLE:\s*(.+)/i);
      const contentMatch = response.match(/CONTENT:\s*([\s\S]+)/i);

      const title = titleMatch
        ? titleMatch[1].trim()
        : `Understanding ${topic || concept}`;

      const content = contentMatch ? contentMatch[1].trim() : response; // Use full response as content if parsing fails

      const processedContent = this.escapeLatexInMath(content);

      return {
        title,
        content:
          processedContent ||
          `This lesson covers ${topic ? `the topic of ${topic} within ${concept}` : `the fundamental concepts and applications of ${concept}`}. It provides ${topic ? 'a focused introduction' : 'a comprehensive introduction'} to help you understand this important ${topic ? 'topic' : 'concept'} in the field.`,
      };
    } catch (error) {
      console.error(`Error generating lesson content for ${concept}:`, error);

      // Fallback content
      return {
        title: `Introduction to ${topic || concept}`,
        content: `This lesson provides an introduction to ${topic || concept}, covering its key principles, applications, and importance in the field. Understanding ${topic || concept} is essential for grasping more advanced topics and practical applications in this domain.`,
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