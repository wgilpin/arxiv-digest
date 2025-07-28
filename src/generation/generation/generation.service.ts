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

        // Normalize quotes to handle smart quotes from AI models
        jsonString = jsonString
          .replace(/[""]/g, '"') // Convert smart quotes to straight quotes
          .replace(/['']/g, "'"); // Convert smart single quotes too

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
   * Generates a list of lesson topics for a given concept, breaking it down into 2-3 minute lessons.
   * @param concept The concept to break down into lesson topics.
   * @returns A promise that resolves to an array of lesson topic strings.
   */
  async generateLessonTopics(concept: string): Promise<string[]> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
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

      // Try to parse JSON response (handle markdown code blocks)
      try {
        let jsonString = response.trim();
        const jsonMatch = jsonString.match(
          /```(?:json)?\s*(\[[\s\S]*?\])\s*```/,
        );
        if (jsonMatch) {
          jsonString = jsonMatch[1];
        } else if (jsonString.startsWith('```') && jsonString.endsWith('```')) {
          jsonString = jsonString
            .slice(3, -3)
            .replace(/^json\s*/, '')
            .trim();
        }

        // Normalize quotes to handle smart quotes from AI models
        jsonString = jsonString
          .replace(/[""]/g, '"') // Convert smart quotes to straight quotes
          .replace(/['']/g, "'") // Convert smart single quotes too
          .replace(/[\u2018\u2019]/g, "'") // Additional smart quote variants
          .replace(/[\u201C\u201D]/g, '"') // Additional smart quote variants
          .trim();

        // Additional JSON cleaning
        jsonString = jsonString
          .replace(/,\s*([}\]])/g, '$1') // Remove trailing commas
          .replace(/([{\[,])\s*,/g, '$1') // Remove leading commas
          .replace(/,+/g, ','); // Replace multiple commas with single

        console.log('Raw AI response:', response);
        console.log('Cleaned JSON string:', jsonString);
        console.log('JSON string length:', jsonString.length);
        console.log('First 50 chars:', jsonString.substring(0, 50));
        
        const topics = JSON.parse(jsonString) as unknown[];
        if (Array.isArray(topics) && topics.length > 0) {
          return (topics as string[]).slice(0, 5); // Limit to 5 lessons max per module
        }
      } catch (parseError) {
        console.error('Failed to parse lesson topics JSON:', parseError);
        console.error('Problematic JSON string:', jsonString);
        console.error('Raw response was:', response);
        
        // Try to extract topics from raw text as fallback
        const lines = response.split('\n').filter(line => line.trim().length > 0);
        const extractedTopics = [];
        
        for (const line of lines) {
          // Look for lines that might be lesson titles
          const cleaned = line.replace(/^[-*•"\[\]0-9.\s]+/, '').replace(/["\[\],]+$/, '').trim();
          if (cleaned.length > 5 && cleaned.length < 100 && !cleaned.includes('TITLE:') && !cleaned.includes('CONTENT:')) {
            extractedTopics.push(cleaned);
          }
        }
        
        if (extractedTopics.length > 0) {
          console.log('Extracted topics from raw text:', extractedTopics);
          return extractedTopics.slice(0, 5);
        }
      }

      // Fallback: provide generic breakdown
      return [
        `Introduction to ${concept}`,
        `Core Principles of ${concept}`,
        `Applications of ${concept}`,
        `Advanced Aspects of ${concept}`,
      ];
    } catch (error) {
      console.error(`Error generating lesson topics for ${concept}:`, error);

      // Fallback topics
      return [
        `Introduction to ${concept}`,
        `Understanding ${concept}`,
        `Practical Applications`,
      ];
    }
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

      const lessonFocus = topic || concept;
      const isTopicSpecific = !!topic;

      const prompt = `
Create a ${isTopicSpecific ? 'focused' : 'comprehensive'} educational lesson about ${isTopicSpecific ? `the topic: "${topic}" (part of the broader concept: "${concept}")` : `the concept: "${concept}"`}

The lesson should be suitable for someone learning this ${isTopicSpecific ? 'topic' : 'concept'} for the first time, but assume they have a basic technical background.

${isTopicSpecific ? 'IMPORTANT: This lesson should be focused, concise, and readable in 2-3 minutes. Focus ONLY on the specific topic provided, not the entire concept.' : ''}

Please structure your response as follows:
TITLE: [A clear, engaging title for the lesson]

CONTENT:
[Write the lesson content in well-formatted Markdown. ${isTopicSpecific ? 'For this focused lesson, include:' : 'Include:'}]
${
  isTopicSpecific
    ? `
- Clear definition/explanation of this specific topic
- Why this topic matters within the broader concept
- Key points or principles for this topic
- Brief practical example or application
- How this topic connects to the overall concept
`
    : `
- Clear definition and explanation of the concept
- Why this concept is important  
- Key principles or components
- Real-world applications or examples
- How it relates to other concepts in the field
- Common misconceptions or challenges
- Further learning resources
`
}

Use proper Markdown formatting:
- **Bold** for important terms and section headers
- *Italics* for emphasis
- \`code\` for technical terms, variables, and mathematical notation
- Bullet points for lists
- Code blocks for examples
- ## for section headers

Make the content engaging, informative, and approximately ${isTopicSpecific ? '200-350 words (2-3 minute read)' : '400-600 words'}.
`;

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
