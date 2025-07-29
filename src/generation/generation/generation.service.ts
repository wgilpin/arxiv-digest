import { Injectable } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Wikipedia integration interfaces
interface WikipediaSearchResult {
  title: string;
  content: string;
  url: string;
  timestamp: number;
  relevanceScore?: number;
}

interface ConceptWithSearchTerms {
  concept: string;
  searchTerms: string[];
}

interface ConceptWithImportance {
  concept: string;
  importance: 'central' | 'supporting' | 'peripheral';
  reasoning: string;
}

interface WikipediaCache {
  [key: string]: {
    data: WikipediaSearchResult;
    expiry: number;
  };
}

interface WikipediaApiSearchResponse {
  query: {
    search: Array<{
      title: string;
      snippet: string;
      size: number;
    }>;
  };
}

interface WikipediaApiContentResponse {
  query: {
    pages: {
      [pageId: string]: {
        title: string;
        extract: string;
        fullurl: string;
      };
    };
  };
}

@Injectable()
export class GenerationService {
  private readonly genAI: GoogleGenerativeAI;
  private readonly wikipediaCache: WikipediaCache = {};
  private readonly maxCacheSize = 100;
  private readonly cacheExpiryHours = 24;

  constructor() {
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }

  /**
   * Retrieves cached Wikipedia content if available and not expired.
   */
  private getCachedWikipediaContent(cacheKey: string): WikipediaSearchResult | null {
    const cached = this.wikipediaCache[cacheKey];
    if (!cached) {
      return null;
    }

    // Check if cache entry has expired
    if (Date.now() > cached.expiry) {
      delete this.wikipediaCache[cacheKey];
      return null;
    }

    return cached.data;
  }

  /**
   * Stores Wikipedia content in cache with expiration and implements LRU eviction.
   */
  private setCachedWikipediaContent(cacheKey: string, content: WikipediaSearchResult): void {
    // Implement LRU eviction if cache is full
    const cacheKeys = Object.keys(this.wikipediaCache);
    if (cacheKeys.length >= this.maxCacheSize) {
      // Find the oldest entry by expiry time
      let oldestKey = cacheKeys[0];
      let oldestExpiry = this.wikipediaCache[oldestKey].expiry;

      for (const key of cacheKeys) {
        if (this.wikipediaCache[key].expiry < oldestExpiry) {
          oldestKey = key;
          oldestExpiry = this.wikipediaCache[key].expiry;
        }
      }

      delete this.wikipediaCache[oldestKey];
    }

    // Store new content with expiration
    const expiryTime = Date.now() + (this.cacheExpiryHours * 60 * 60 * 1000);
    this.wikipediaCache[cacheKey] = {
      data: content,
      expiry: expiryTime,
    };
  }

  /**
   * Sanitizes a topic string for use as a cache key.
   */
  private sanitizeTopicForCache(topic: string): string {
    return topic.toLowerCase().replace(/[^a-z0-9]/g, '_');
  }

  /**
   * Makes a retry-enabled request to Wikipedia API with exponential backoff.
   */
  private async wikipediaApiRequest(url: string, maxRetries = 3): Promise<any> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'ArXivLearningTool/1.0 (Educational Purpose)',
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`Wikipedia API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        console.error(`Wikipedia API attempt ${attempt} failed:`, error);
        
        if (attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delayMs = Math.pow(2, attempt - 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Searches Wikipedia for articles related to the given topic.
   */
  private async searchWikipediaArticles(query: string): Promise<Array<{title: string, snippet: string, size: number}>> {
    const searchUrl = new URL('https://en.wikipedia.org/w/api.php');
    searchUrl.searchParams.append('action', 'query');
    searchUrl.searchParams.append('list', 'search');
    searchUrl.searchParams.append('srsearch', query);
    searchUrl.searchParams.append('srlimit', '5');
    searchUrl.searchParams.append('format', 'json');
    searchUrl.searchParams.append('origin', '*');

    try {
      const response = await this.wikipediaApiRequest(searchUrl.toString()) as WikipediaApiSearchResponse;
      return response.query.search || [];
    } catch (error) {
      console.error('Error searching Wikipedia:', error);
      return [];
    }
  }

  /**
   * Retrieves the full content of a Wikipedia article by title.
   */
  private async getWikipediaArticleContent(title: string): Promise<{title: string, content: string, url: string} | null> {
    const contentUrl = new URL('https://en.wikipedia.org/w/api.php');
    contentUrl.searchParams.append('action', 'query');
    contentUrl.searchParams.append('prop', 'extracts|info');
    contentUrl.searchParams.append('titles', title);
    contentUrl.searchParams.append('exintro', 'false');
    contentUrl.searchParams.append('explaintext', 'true');
    contentUrl.searchParams.append('inprop', 'url');
    contentUrl.searchParams.append('format', 'json');
    contentUrl.searchParams.append('origin', '*');

    try {
      const response = await this.wikipediaApiRequest(contentUrl.toString()) as WikipediaApiContentResponse;
      const pages = response.query.pages;
      const pageId = Object.keys(pages)[0];
      const page = pages[pageId];

      if (pageId === '-1' || !page.extract) {
        return null; // Page not found or no content
      }

      return {
        title: page.title,
        content: page.extract,
        url: page.fullurl,
      };
    } catch (error) {
      console.error(`Error fetching Wikipedia content for "${title}":`, error);
      return null;
    }
  }

  /**
   * Calculates Levenshtein distance between two strings for similarity scoring.
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(0));

    for (let i = 0; i <= str1.length; i++) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j++) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculates relevance score for a Wikipedia search result.
   */
  private calculateRelevanceScore(
    searchResult: {title: string, snippet: string, size: number},
    topic: string,
    concept: string
  ): number {
    const title = searchResult.title.toLowerCase();
    const snippet = searchResult.snippet.toLowerCase();
    const topicLower = topic.toLowerCase();
    const conceptLower = concept.toLowerCase();

    let score = 0;

    // Title similarity (Levenshtein distance based)
    const titleDistance = this.levenshteinDistance(title, topicLower);
    const maxTitleLength = Math.max(title.length, topicLower.length);
    const titleSimilarity = maxTitleLength > 0 ? 1 - (titleDistance / maxTitleLength) : 0;
    score += titleSimilarity * 0.4; // 40% weight for title similarity

    // Exact topic match in title gets bonus
    if (title.includes(topicLower)) {
      score += 0.3;
    }

    // Concept context relevance
    if (snippet.includes(conceptLower) || title.includes(conceptLower)) {
      score += 0.2;
    }

    // Article size factor (longer articles often more comprehensive)
    const sizeScore = Math.min(searchResult.size / 10000, 1) * 0.1; // Normalize to 10KB, cap at 0.1
    score += sizeScore;

    // Penalize disambiguation pages
    if (title.includes('disambiguation') || snippet.includes('may refer to')) {
      score *= 0.3;
    }

    // Penalize list pages (they're usually not great for learning)
    if (title.startsWith('list of') || title.includes('category:')) {
      score *= 0.4;
    }

    return Math.min(score, 1); // Cap at 1.0
  }

  /**
   * Ranks and selects the best Wikipedia search result.
   */
  private rankAndSelectBestResult(
    searchResults: Array<{title: string, snippet: string, size: number}>,
    topic: string,
    concept: string
  ): {title: string, snippet: string, size: number, relevanceScore: number} | null {
    if (searchResults.length === 0) {
      return null;
    }

    // Calculate relevance scores for all results
    const scoredResults = searchResults.map(result => ({
      ...result,
      relevanceScore: this.calculateRelevanceScore(result, topic, concept),
    }));

    // Sort by relevance score (descending)
    scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    const bestResult = scoredResults[0];

    // Apply quality thresholds
    if (bestResult.relevanceScore < 0.2) {
      console.log(`No Wikipedia result met quality threshold for topic: ${topic}`);
      return null;
    }

    // If top result has high confidence, select it
    if (bestResult.relevanceScore > 0.8) {
      return bestResult;
    }

    // If multiple results have similar scores, prefer the one with more content
    const secondBest = scoredResults[1];
    if (secondBest && Math.abs(bestResult.relevanceScore - secondBest.relevanceScore) < 0.2) {
      return bestResult.size > secondBest.size ? bestResult : secondBest;
    }

    return bestResult;
  }

  /**
   * Validates whether Wikipedia content is relevant and suitable for creating a lesson.
   */
  private async validateWikipediaContent(content: string, topic: string, concept: string): Promise<boolean> {
    try {
      // Basic quality checks first (fast, no LLM needed)
      if (content.length < 200) {
        console.log(`Wikipedia content too short for topic: ${topic}`);
        return false;
      }

      // Check for stub articles
      if (content.toLowerCase().includes('is a stub') || content.toLowerCase().includes('stub article')) {
        console.log(`Wikipedia article is a stub for topic: ${topic}`);
        return false;
      }

      // Check for disambiguation pages
      if (content.toLowerCase().includes('may refer to:') || content.toLowerCase().includes('disambiguation')) {
        console.log(`Wikipedia article is disambiguation page for topic: ${topic}`);
        return false;
      }

      // LLM validation for relevance
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const validationPrompt = `
Evaluate whether the following Wikipedia article content is relevant and suitable for creating a lesson about the topic: "${topic}" within the broader concept of "${concept}".

Consider:
- Does the content directly address the topic?
- Is the content at an appropriate technical level for academic learning?
- Does the content contain sufficient detail for a 2-3 minute lesson?
- Is the content factual and educational (not opinion-based)?

Article Content (first 500 words):
${content.slice(0, 2000)}

Respond with only "RELEVANT" or "NOT_RELEVANT" followed by a brief reason.
`;

      const result = await model.generateContent(validationPrompt);
      const response = result.response.text().trim();

      const isRelevant = response.toUpperCase().startsWith('RELEVANT');
      
      if (!isRelevant) {
        console.log(`LLM validation failed for topic: ${topic}. Response: ${response}`);
      }
      console.log(`LLM validation succeeded for topic: ${topic}`);
      return isRelevant;
    } catch (error) {
      console.error(`Error validating Wikipedia content for topic: ${topic}`, error);
      // If validation fails, be conservative and assume not relevant
      return false;
    }
  }

  /**
   * Extracts key concepts from the provided paper text using Gemini-2.5-flash.
   * @param paperText The text of the paper.
   * @returns A promise that resolves to an array of extracted concepts.
   */
  async extractConcepts(paperText: string): Promise<string[]> {
    const conceptsWithImportance = await this.extractConceptsWithImportance(paperText);
    return conceptsWithImportance.map(item => item.concept);
  }

  /**
   * Generates alternative search terms for a concept to improve Wikipedia search success.
   */
  private async generateSearchTerms(concept: string): Promise<string[]> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const prompt = `
Generate 3-4 alternative search terms for finding the Wikipedia article about: "${concept}"

Focus on:
- The most common/standard name for this concept
- Alternative names or spellings
- Broader category it belongs to
- More specific technical terms

IMPORTANT: Return ONLY a valid JSON array of strings, ordered from most likely to find a good Wikipedia article to least likely.

Example for "Martingale Property Violation":
["Martingale", "Martingale Theory", "Stochastic Process", "Mathematical Finance"]

Example for "In-Context Learning":
["In-Context Learning", "Few-Shot Learning", "Prompt Engineering", "Large Language Model"]

Concept: ${concept}
`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      try {
        // Clean and parse JSON response
        let jsonString = response.trim();
        const jsonMatch = jsonString.match(/(\[[\s\S]*?\])/);
        if (jsonMatch) {
          jsonString = jsonMatch[0];
        }

        const searchTerms = JSON.parse(jsonString) as unknown[];
        if (Array.isArray(searchTerms) && searchTerms.length > 0) {
          return (searchTerms as string[]).slice(0, 4);
        }
      } catch (parseError) {
        console.error('Failed to parse search terms JSON:', parseError);
      }

      // Fallback: return the original concept and a cleaned version
      const cleanedConcept = concept
        .replace(/\s+(Property|Violation|Method|Algorithm|Technique)$/i, '')
        .trim();
      
      return [concept, cleanedConcept].filter((term, index, arr) => 
        term.length > 0 && arr.indexOf(term) === index
      );

    } catch (error) {
      console.error(`Error generating search terms for ${concept}:`, error);
      return [concept];
    }
  }

  /**
   * Searches Wikipedia with caching and disambiguation handling.
   */
  private async searchWikipedia(query: string, concept: string): Promise<WikipediaSearchResult | null> {
    const cacheKey = `wikipedia:${this.sanitizeTopicForCache(query)}`;
    
    // Check cache first
    const cached = this.getCachedWikipediaContent(cacheKey);
    if (cached) {
      console.log(`Cache hit for Wikipedia topic: ${query}`);
      return cached;
    }

    try {
      console.log(`Searching Wikipedia for topic: ${query}`);
      
      // Generate alternative search terms
      const searchTerms = await this.generateSearchTerms(query);
      console.log(`Generated search terms: ${searchTerms.join(', ')}`);
      
      // Try each search term until we find a good result
      for (const searchTerm of searchTerms) {
        console.log(`Trying search term: "${searchTerm}"`);
        
        // Search for articles with this term
        const searchResults = await this.searchWikipediaArticles(searchTerm);
        if (searchResults.length === 0) {
          console.log(`No Wikipedia results found for search term: ${searchTerm}`);
          continue; // Try next search term
        }

        // Rank and select best result for this search term
        const bestResult = this.rankAndSelectBestResult(searchResults, searchTerm, concept);
        if (!bestResult) {
          console.log(`No suitable Wikipedia result found for search term: ${searchTerm}`);
          continue; // Try next search term
        }

        console.log(`Selected Wikipedia article: "${bestResult.title}" (score: ${bestResult.relevanceScore.toFixed(2)}) for search term: "${searchTerm}"`);

        // Get full article content
        const articleContent = await this.getWikipediaArticleContent(bestResult.title);
        if (!articleContent) {
          console.log(`Failed to fetch Wikipedia content for: ${bestResult.title}`);
          continue; // Try next search term
        }

        // Validate content quality
        const isValid = await this.validateWikipediaContent(articleContent.content, query, concept);
        if (!isValid) {
          console.log(`Wikipedia content validation failed for: ${bestResult.title}, trying next search term`);
          continue; // Try next search term
        }

        // Success! Create result object
        const result: WikipediaSearchResult = {
          title: articleContent.title,
          content: articleContent.content,
          url: articleContent.url,
          timestamp: Date.now(),
          relevanceScore: bestResult.relevanceScore,
        };

        // Cache the result
        this.setCachedWikipediaContent(cacheKey, result);

        console.log(`Successfully processed Wikipedia article for topic: ${query} using search term: "${searchTerm}"`);
        return result;
      }
      
      // If we get here, none of the search terms worked
      console.log(`All search terms failed for topic: ${query}`);
      return null;

    } catch (error) {
      console.error(`Error searching Wikipedia for topic: ${query}`, error);
      return null;
    }
  }

  /**
   * Generates a single comprehensive summary lesson for peripheral concepts.
   */
  async generateSummaryLesson(
    concept: string,
    knowledgeLevel?: string,
    paperContent?: string,
  ): Promise<{ title: string; content: string }> {
    // Always use the broader concept for Wikipedia search
    const searchQuery = concept;
    console.log(`Generating summary lesson for peripheral concept: "${concept}"`);

    try {
      // Step 1: Try Wikipedia first
      console.log('Attempting Wikipedia content generation for summary lesson...');
      const wikipediaResult = await this.searchWikipedia(searchQuery, concept);
      
      if (wikipediaResult) {
        console.log(`Using Wikipedia article for summary: "${wikipediaResult.title}"`);
        const lesson = await this.summarizeWikipediaForSummary(
          wikipediaResult.content,
          concept,
          wikipediaResult.title,
          wikipediaResult.url,
          paperContent
        );
        console.log(`Successfully generated summary lesson from Wikipedia for: ${concept}`);
        return lesson;
      }

      console.log('Wikipedia content not suitable for summary, falling back to LLM generation...');

    } catch (error) {
      console.error('Error with Wikipedia content generation for summary:', error);
      console.log('Falling back to LLM generation for summary due to Wikipedia error...');
    }

    // Step 2: Fallback to LLM-based summary generation
    console.log('Using LLM-based summary generation as fallback...');
    try {
      const fallbackLesson = await this.generateLLMSummaryLesson(concept, knowledgeLevel, paperContent);
      console.log(`Successfully generated summary lesson using LLM fallback for: ${concept}`);
      return fallbackLesson;
    } catch (error) {
      console.error('Error with LLM fallback summary generation:', error);
      
      // Ultimate fallback
      return {
        title: `Overview of ${concept}`,
        content: `This lesson provides a brief overview of ${concept} as it relates to understanding the research paper. ${concept} is mentioned in the paper but is not central to the main contribution.`,
      };
    }
  }

  /**
   * Summarizes Wikipedia content into a single comprehensive lesson for peripheral concepts.
   */
  private async summarizeWikipediaForSummary(
    articleContent: string,
    concept: string,
    wikipediaTitle: string,
    wikipediaUrl: string,
    paperContent?: string
  ): Promise<{ title: string; content: string }> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const paperContextSection = paperContent ? `

CRITICAL CONTEXT - Paper-Specific Focus:
This is a SUMMARY lesson for a peripheral concept. The goal is to provide just enough understanding of "${concept}" to comprehend its role in this research paper. Focus on the essential aspects that help the reader understand why this concept is mentioned in the paper.

Here are key excerpts from the original paper for context:
${paperContent.slice(0, 3000)}

IMPORTANT: Keep this concise - this is not a central concept to the paper.` : '';

      const prompt = `
Create a concise summary lesson about "${concept}" using the following Wikipedia article content.

This is a PERIPHERAL concept - provide just enough information for basic understanding in the context of academic research.${paperContextSection}

Please structure your response as follows:
TITLE: [A clear, concise title]

CONTENT:
[Write a brief lesson in well-formatted Markdown, approximately 150-250 words covering:]
- **Definition**: Clear, concise explanation of what ${concept} is
- **Context**: Why this concept appears in academic research
- **Key Point**: The most important thing to understand about this concept${paperContent ? '\n- **Paper Connection**: Brief note on how this relates to the research' : ''}

Use proper Markdown formatting but keep it concise since this is a peripheral concept.

IMPORTANT: End with: "**Source:** [${wikipediaTitle}](${wikipediaUrl}) (Wikipedia)"

Wikipedia Article Content:
${articleContent.slice(0, 5000)}
`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      // Parse the structured response
      const titleMatch = response.match(/TITLE:\s*(.+)/i);
      const contentMatch = response.match(/CONTENT:\s*([\s\S]+)/i);

      const title = titleMatch ? titleMatch[1].trim() : `Overview of ${concept}`;
      let content = contentMatch ? contentMatch[1].trim() : response;

      // Ensure source attribution is present
      if (!content.includes('**Source:**')) {
        content += `\n\n**Source:** [${wikipediaTitle}](${wikipediaUrl}) (Wikipedia)`;
      }

      const processedContent = this.escapeLatexInMath(content);

      return {
        title,
        content: processedContent || `Brief overview of ${concept} as it relates to the research paper.`,
      };
    } catch (error) {
      console.error(`Error summarizing Wikipedia content for summary of ${concept}:`, error);

      return {
        title: `Overview of ${concept}`,
        content: `Brief overview of ${concept} as it relates to understanding the research paper.\n\n**Source:** [${wikipediaTitle}](${wikipediaUrl}) (Wikipedia)`,
      };
    }
  }

  /**
   * Generates a summary lesson using LLM without Wikipedia content.
   */
  private async generateLLMSummaryLesson(
    concept: string,
    knowledgeLevel?: string,
    paperContent?: string
  ): Promise<{ title: string; content: string }> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const paperContextSection = paperContent ? `

CRITICAL CONTEXT - Paper-Specific Focus:
This is a SUMMARY lesson for a peripheral concept. The goal is to provide just enough understanding of "${concept}" to comprehend its role in this research paper.

Here are key excerpts from the original paper for context:
${paperContent.slice(0, 3000)}

IMPORTANT: Keep this concise - this is not a central concept to the paper.` : '';

      const knowledgeLevelContext = knowledgeLevel ? `

The user has self-assessed their knowledge of "${concept}" as: "${knowledgeLevel}". Provide an appropriate level of detail for someone at this knowledge level.` : '';

      const prompt = `
Create a concise summary lesson about the concept: "${concept}"

This is a PERIPHERAL concept - provide just enough information for basic understanding in an academic research context.${knowledgeLevelContext}${paperContextSection}

Please structure your response as follows:
TITLE: [A clear, concise title]

CONTENT:
[Write a brief lesson in well-formatted Markdown, approximately 150-250 words covering:]
- **Definition**: Clear, concise explanation of what ${concept} is
- **Context**: Why this concept appears in academic research
- **Key Point**: The most important thing to understand about this concept${paperContent ? '\n- **Paper Connection**: Brief note on how this relates to the research' : ''}

Use proper Markdown formatting but keep it concise since this is a peripheral concept.
`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      // Parse the structured response
      const titleMatch = response.match(/TITLE:\s*(.+)/i);
      const contentMatch = response.match(/CONTENT:\s*([\s\S]+)/i);

      const title = titleMatch ? titleMatch[1].trim() : `Overview of ${concept}`;
      const content = contentMatch ? contentMatch[1].trim() : response;

      const processedContent = this.escapeLatexInMath(content);

      return {
        title,
        content: processedContent || `Brief overview of ${concept} as it relates to understanding the research paper.`,
      };
    } catch (error) {
      console.error(`Error generating LLM summary lesson for ${concept}:`, error);

      return {
        title: `Overview of ${concept}`,
        content: `Brief overview of ${concept} as it relates to understanding the research paper.`,
      };
    }
  }

  /**
   * Summarizes Wikipedia article content into a lesson.
   */
  private async summarizeWikipediaArticle(
    articleContent: string,
    topic: string,
    concept: string,
    wikipediaTitle: string,
    wikipediaUrl: string,
    paperContent?: string
  ): Promise<{ title: string; content: string }> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const paperContextSection = paperContent ? `

CRITICAL CONTEXT - Original Paper Focus:
The goal of this lesson is NOT to teach "${concept}" comprehensively, but specifically to help the reader understand how "${concept}" is used and applied in this research paper. Focus on the aspects, applications, and nuances of "${concept}" that are most relevant to understanding the paper's methodology, contributions, and results.

Here are key excerpts from the original paper for context (focus your lesson on these aspects):
${paperContent.slice(0, 4000)}

IMPORTANT: Tailor your explanation to bridge the gap between general knowledge of "${concept}" and its specific application in this research paper.` : '';

      const prompt = `
Create a focused educational lesson about the topic: "${topic}" (part of the broader concept: "${concept}") using the following Wikipedia article content.

${paperContent ? 'Your goal is to help the user understand this topic sufficiently to comprehend the research paper provided in the context below.' : 'The lesson should help the user understand this topic at an appropriate technical level.'}${paperContextSection}

IMPORTANT: This lesson should be focused, concise, and readable in 2-3 minutes. Focus ONLY on the specific topic provided, not the entire concept.

Please structure your response as follows:
TITLE: [A clear, engaging title for the lesson]

CONTENT:
[Write the lesson content in well-formatted Markdown. For this focused lesson, include:]
- Clear definition/explanation of this specific topic
- Why this topic matters within the broader concept${paperContent ? '\n- How this concept is specifically used in the research context provided' : ''}
- Key points or principles for this topic
- Brief practical example or application${paperContent ? ' (preferably related to the paper context)' : ''}
- How this topic connects to the overall concept${paperContent ? ' and the research methodology' : ''}

Use proper Markdown formatting:
- **Bold** for important terms and section headers
- *Italics* for emphasis
- \`code\` for technical terms, variables, and mathematical notation
- Bullet points for lists
- Code blocks for examples
- ## for section headers

Make the content engaging, informative, and approximately 200-350 words (2-3 minute read).

IMPORTANT: End the lesson with a source attribution: "**Source:** [${wikipediaTitle}](${wikipediaUrl}) (Wikipedia)"

Wikipedia Article Content:
${articleContent.slice(0, 8000)} // Use more content for better context
`;

      const result = await model.generateContent(prompt);
      const response = result.response.text();

      // Parse the structured response
      const titleMatch = response.match(/TITLE:\s*(.+)/i);
      const contentMatch = response.match(/CONTENT:\s*([\s\S]+)/i);

      const title = titleMatch
        ? titleMatch[1].trim()
        : `Understanding ${topic}`;

      let content = contentMatch ? contentMatch[1].trim() : response;

      // Ensure source attribution is present
      if (!content.includes('**Source:**')) {
        content += `\n\n**Source:** [${wikipediaTitle}](${wikipediaUrl}) (Wikipedia)`;
      }

      const processedContent = this.escapeLatexInMath(content);

      return {
        title,
        content: processedContent || `This lesson covers the topic of ${topic} within ${concept}, providing a focused introduction based on Wikipedia content.`,
      };
    } catch (error) {
      console.error(`Error summarizing Wikipedia content for ${topic}:`, error);

      // Fallback content with source attribution
      return {
        title: `Introduction to ${topic}`,
        content: `This lesson provides an introduction to ${topic}, covering its key principles, applications, and importance in the field of ${concept}.\n\n**Source:** [${wikipediaTitle}](${wikipediaUrl}) (Wikipedia)`,
      };
    }
  }

  /**
   * Generates lesson content from external sources (Wikipedia first, then fallback to LLM).
   * This is the main method that orchestrates the content generation process.
   */
  async generateLessonFromExternalSources(
    concept: string,
    topic?: string,
    previousLessons?: Array<{ title: string; content: string }>,
    knowledgeLevel?: string,
    paperContent?: string,
  ): Promise<{ title: string; content: string }> {
    // Always use the broader concept for Wikipedia search, not the specific lesson topic
    const searchQuery = concept;
    console.log(`Generating lesson for topic: "${topic || concept}" within concept: "${concept}"`);
    console.log(`Using Wikipedia search query: "${searchQuery}"`);

    try {
      // Step 1: Try Wikipedia
      console.log('Attempting Wikipedia content generation...');
      const wikipediaResult = await this.searchWikipedia(searchQuery, concept);
      
      if (wikipediaResult) {
        console.log(`Using Wikipedia article: "${wikipediaResult.title}"`);
        const lesson = await this.summarizeWikipediaArticle(
          wikipediaResult.content,
          topic || concept, // Use the specific topic for lesson content, not the search query
          concept,
          wikipediaResult.title,
          wikipediaResult.url,
          paperContent
        );
        console.log(`Successfully generated lesson from Wikipedia for: ${searchQuery}`);
        return lesson;
      }

      console.log('Wikipedia content not suitable, falling back to LLM generation...');

    } catch (error) {
      console.error('Error with Wikipedia content generation:', error);
      console.log('Falling back to LLM generation due to Wikipedia error...');
    }

    // Step 2: Fallback to existing LLM generation
    console.log('Using LLM-based content generation as fallback...');
    try {
      const fallbackLesson = await this.generateLessonContent(
        concept,
        topic,
        previousLessons,
        knowledgeLevel,
        paperContent
      );
      console.log(`Successfully generated lesson using LLM fallback for: ${searchQuery}`);
      return fallbackLesson;
    } catch (error) {
      console.error('Error with LLM fallback generation:', error);
      
      // Ultimate fallback
      return {
        title: `Introduction to ${topic || concept}`,
        content: `This lesson provides an introduction to ${topic || concept}, covering its key principles, applications, and importance in the field. Understanding ${topic || concept} is essential for grasping more advanced topics and practical applications in this domain.`,
      };
    }
  }

  /**
   * Extracts key concepts with importance rankings from the provided paper text.
   * @param paperText The text of the paper.
   * @returns A promise that resolves to an array of concepts with importance levels.
   */
  async extractConceptsWithImportance(paperText: string): Promise<ConceptWithImportance[]> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
        },
      });

      const prompt = `
Analyze this academic paper and extract 8-12 key technical concepts that would be essential for understanding this paper. 

For each concept, determine its importance level for understanding this specific paper:
- **central**: Core to the paper's main contribution, methodology, or results. Reader must understand this deeply.
- **supporting**: Important for understanding key sections or context. Reader needs good familiarity.
- **peripheral**: Mentioned or used but not central to understanding the main ideas. Basic awareness sufficient.

Focus on:
- Core algorithms, techniques, or methodologies
- Mathematical concepts or models
- Technical terms specific to the field
- Fundamental theories or principles
- Important data structures or architectures

IMPORTANT: Return ONLY a valid JSON array of objects with this exact format:
[
  {
    "concept": "Neural Networks",
    "importance": "central",
    "reasoning": "Core methodology used throughout the paper's experiments"
  },
  {
    "concept": "Backpropagation",
    "importance": "supporting", 
    "reasoning": "Training method mentioned but not the main focus"
  },
  {
    "concept": "Gradient Descent",
    "importance": "peripheral",
    "reasoning": "Brief mention in optimization context"
  }
]

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

        const conceptsWithImportance = JSON.parse(jsonString) as unknown[];
        if (Array.isArray(conceptsWithImportance) && conceptsWithImportance.length > 0) {
          return (conceptsWithImportance as ConceptWithImportance[]).slice(0, 12); // Limit to 12 concepts max
        }
      } catch (parseError) {
        console.error('Failed to parse concepts JSON:', parseError);
        console.error('Raw response:', response);
      }

      // Fallback: extract concept names from response text and assign default importance
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

      // Convert to ConceptWithImportance format with default importance
      const fallbackConcepts = extractedConcepts.length > 0
        ? extractedConcepts
        : ['Machine Learning', 'Neural Networks', 'Deep Learning']; // Ultimate fallback

      return fallbackConcepts.map(concept => ({
        concept,
        importance: 'central' as const, // Default to central when we can't determine importance
        reasoning: 'Extracted from paper text (importance not determined)'
      }));
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
      ].map(concept => ({
        concept,
        importance: 'central' as const,
        reasoning: 'Default fallback concept'
      }));
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
                console.log(`Cleanup strategy ${i + 1} failed:`, (e2 as Error).message);
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

  private generateFocusedLessonPrompt(
    concept: string, 
    topic: string,
    previousLessons?: Array<{ title: string; content: string }>,
    knowledgeLevel?: string,
    paperContent?: string
  ): string {
    const previousLessonsContext = previousLessons && previousLessons.length > 0 
      ? `
IMPORTANT CONTEXT - Previous lessons in this module:
${previousLessons.map((lesson, index) => `
${index + 1}. "${lesson.title}"
${lesson.content}
`).join('\n')}

CRITICAL: Do NOT repeat information that has already been covered in the previous lessons above. Build upon what has been taught, but avoid duplicating explanations, examples, or concepts that have already been thoroughly covered.` 
      : '';

    const knowledgeLevelContext = knowledgeLevel 
      ? `

IMPORTANT: The user has self-assessed their knowledge level for "${concept}" as: "${knowledgeLevel}". 
Tailor the lesson complexity, examples, and explanations to be appropriate for someone at this knowledge level. ${knowledgeLevel === 'No knowledge of the concept' ? 'Start with fundamentals and avoid assumptions about prior knowledge.' : knowledgeLevel === 'Basic understanding of the concept' ? 'Build on basic concepts but explain technical details thoroughly.' : 'Focus on technical depth while avoiding redundant basic explanations.'}`
      : '';

    const paperContextSection = paperContent ? `

CRITICAL CONTEXT - Original Paper Focus:
The goal of this lesson is NOT to teach "${topic}" comprehensively, but specifically to help the reader understand how "${topic}" relates to "${concept}" as used in this research paper. Focus on the aspects, applications, and nuances that are most relevant to understanding the paper's methodology, contributions, and results.

Here are key excerpts from the original paper for context (focus your lesson on these aspects):
${paperContent.slice(0, 4000)}

IMPORTANT: Tailor your explanation to bridge the gap between general knowledge and its specific application in this research paper.` : '';

    return `
Create a focused educational lesson about the topic: "${topic}" (part of the broader concept: "${concept}")

${knowledgeLevel ? `The user has self-assessed their knowledge of "${concept}" as: "${knowledgeLevel}". Your goal is to bridge the gap between their current understanding and what's needed to comprehend the research paper.` : 'The lesson should help the user understand this topic sufficiently to comprehend the research paper.'}${previousLessonsContext}${paperContextSection}

IMPORTANT: This lesson should be focused, concise, and readable in 2-3 minutes. Focus ONLY on the specific topic provided, not the entire concept.

Please structure your response as follows:
TITLE: [A clear, engaging title for the lesson]

CONTENT:
[Write the lesson content in well-formatted Markdown. For this focused lesson, include:]
- Clear definition/explanation of this specific topic
- Why this topic matters within the broader concept${paperContent ? '\n- How this topic is specifically used in the research context provided' : ''}
- Key points or principles for this topic
- Brief practical example or application${paperContent ? ' (preferably related to the paper context)' : ''}
- How this topic connects to the overall concept${paperContent ? ' and the research methodology' : ''}

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

  private generateComprehensiveLessonPrompt(
    concept: string,
    previousLessons?: Array<{ title: string; content: string }>,
    knowledgeLevel?: string,
    paperContent?: string
  ): string {
    const previousLessonsContext = previousLessons && previousLessons.length > 0 
      ? `
IMPORTANT CONTEXT - Previous lessons in this module:
${previousLessons.map((lesson, index) => `
${index + 1}. "${lesson.title}"
${lesson.content}
`).join('\n')}

CRITICAL: Do NOT repeat information that has already been covered in the previous lessons above. Build upon what has been taught, but avoid duplicating explanations, examples, or concepts that have already been thoroughly covered.` 
      : '';

    const knowledgeLevelContext = knowledgeLevel 
      ? `

IMPORTANT: The user has self-assessed their knowledge level for "${concept}" as: "${knowledgeLevel}". 
Tailor the lesson complexity, examples, and explanations to be appropriate for someone at this knowledge level. ${knowledgeLevel === 'No knowledge of the concept' ? 'Start with fundamentals and avoid assumptions about prior knowledge.' : knowledgeLevel === 'Basic understanding of the concept' ? 'Build on basic concepts but explain technical details thoroughly.' : 'Focus on technical depth while avoiding redundant basic explanations.'}`
      : '';

    const paperContextSection = paperContent ? `

CRITICAL CONTEXT - Original Paper Focus:  
The goal of this lesson is NOT to teach "${concept}" comprehensively, but specifically to help the reader understand how "${concept}" is used and applied in this research paper. Focus on the aspects, applications, and nuances of "${concept}" that are most relevant to understanding the paper's methodology, contributions, and results.

Here are key excerpts from the original paper for context (focus your lesson on these aspects):
${paperContent.slice(0, 4000)}

IMPORTANT: Tailor your explanation to bridge the gap between general knowledge of "${concept}" and its specific application in this research paper.` : '';

    return `
Create a comprehensive educational lesson about the concept: "${concept}"

${knowledgeLevel ? `The user has self-assessed their knowledge of "${concept}" as: "${knowledgeLevel}". Your goal is to bridge the gap between their current understanding and what's needed to comprehend the research paper.` : 'The lesson should help the user understand this concept sufficiently to comprehend the research paper.'}${previousLessonsContext}${paperContextSection}

Please structure your response as follows:
TITLE: [A clear, engaging title for the lesson]

CONTENT:
[Write the lesson content in well-formatted Markdown. Include:]
- Clear definition and explanation of the concept
- Why this concept is important${paperContent ? '\n- How this concept is specifically used in the research context provided' : ''}
- Key principles or components
- Real-world applications or examples${paperContent ? ' (preferably related to the paper context)' : ''}
- How it relates to other concepts in the field${paperContent ? ' and the research methodology' : ''}
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
   * @param previousLessons Previous lessons in the same module for context.
   * @param knowledgeLevel User's self-assessed knowledge level for this concept.
   * @returns A promise that resolves to an object containing the lesson title and content.
   */
  async generateLessonContent(
    concept: string,
    topic?: string,
    previousLessons?: Array<{ title: string; content: string }>,
    knowledgeLevel?: string,
    paperContent?: string,
  ): Promise<{ title: string; content: string }> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });

      const prompt = topic
        ? this.generateFocusedLessonPrompt(concept, topic, previousLessons, knowledgeLevel, paperContent)
        : this.generateComprehensiveLessonPrompt(concept, previousLessons, knowledgeLevel, paperContent);

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
    // It needs to distinguish between LaTeX math ($x + y$) and currency ($1, $100)
    
    // First handle block math ($$...$$)
    let result = text.replace(
      /\$\$(.*?)\$\$/gs,
      (match: string, content: string) => {
        return `$$${content.replace(/\\/g, '\\\\')}$$`;
      },
    );
    
    // Then handle inline math, but be more careful about currency
    // Only treat as LaTeX if it contains typical math characters
    result = result.replace(
      /\$([^$]*?)\$/g,
      (match: string, content: string) => {
        // Check if this looks like math (contains letters, operators, spaces, etc.)
        // vs currency (just numbers and maybe decimals)
        const mathPattern = /[a-zA-Z\\+\-*/=<>^_{}[\]()\\|~\s]/;
        
        if (mathPattern.test(content)) {
          // Looks like math, escape backslashes
          return `$${content.replace(/\\/g, '\\\\')}$`;
        } else {
          // Looks like currency or simple number, leave as-is
          return match;
        }
      },
    );
    
    return result;
  }
}