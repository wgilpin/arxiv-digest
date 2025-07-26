import { Injectable } from '@nestjs/common';
import axios from 'axios';
import * as xml2js from 'xml2js';

@Injectable()
export class ArxivService {
  private readonly ARXIV_API_URL = 'http://export.arxiv.org/api/query';

  /**
   * Fetches the title of a paper from ArXiv.
   * @param arxivId The ArXiv ID of the paper.
   * @returns A promise that resolves to the paper's title.
   */
  async fetchPaperTitle(arxivId: string): Promise<string> {
    try {
      const response = await axios.get(this.ARXIV_API_URL, {
        params: {
          id_list: arxivId,
        },
      });

      const parser = new xml2js.Parser({ explicitArray: false });
      const result = await parser.parseStringPromise(response.data);

      const entry = result.feed.entry;
      if (entry && entry.title) {
        return entry.title;
      }
      return 'Title not found';
    } catch (error) {
      console.error(
        `Error fetching paper title for ID ${arxivId}:`,
        error.message,
      );
      return 'Error fetching title';
    }
  }

  /**
   * Retrieves the text of a paper given its ArXiv ID.
   * For now, this method returns a hardcoded string of dummy text for testing.
   * @param arxivId The ArXiv ID of the paper.
   * @returns A promise that resolves to the paper's text.
   */
  async getPaperText(arxivId: string): Promise<string> {
    return 'This paper introduces the Transformer, a novel network architecture...';
  }
}
