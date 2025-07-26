import { Injectable } from '@nestjs/common';

@Injectable()
export class GenerationService {
  /**
   * Extracts concepts from the provided paper text.
   * For now, this method returns a hardcoded array of strings for testing.
   * @param paperText The text of the paper.
   * @returns A promise that resolves to an array of extracted concepts.
   */
  async extractConcepts(paperText: string): Promise<string[]> {
    return ['Transformers', 'Self-Attention', 'Positional Encoding'];
  }
}
