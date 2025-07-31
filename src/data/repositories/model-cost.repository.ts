import { Injectable } from '@nestjs/common';
import { FirestoreService } from '../../firestore/firestore.service';
import { ModelCost } from '../../firestore/interfaces/firestore.interfaces';

@Injectable()
export class ModelCostRepository {
  private readonly collectionName = 'model-costs';

  constructor(private firestoreService: FirestoreService) {}

  /**
   * Find all model costs
   */
  async findAllActive(): Promise<ModelCost[]> {
    try {
      const firestore = this.firestoreService.getFirestore();
      const snapshot = await firestore
        .collection(this.collectionName)
        .get();

      return snapshot.docs.map((doc: any) => ({
        id: doc.id,
        modelName: doc.id, // Use document ID as model name
        ...doc.data(),
      })) as ModelCost[];
    } catch (error) {
      console.error('Error fetching model costs:', error);
      return [];
    }
  }

  /**
   * Find model cost by model name
   */
  async findByModelName(modelName: string): Promise<ModelCost | null> {
    try {
      const firestore = this.firestoreService.getFirestore();
      const doc = await firestore
        .collection(this.collectionName)
        .doc(modelName)
        .get();

      if (!doc.exists) {
        return null;
      }

      return {
        id: doc.id,
        modelName: doc.id,
        ...doc.data(),
      } as ModelCost;
    } catch (error) {
      console.error(`Error fetching model cost for ${modelName}:`, error);
      return null;
    }
  }

  /**
   * Get a map of model names to costs for efficient lookup
   */
  async getModelCostMap(): Promise<Record<string, ModelCost>> {
    const modelCosts = await this.findAllActive();
    const costMap: Record<string, ModelCost> = {};
    
    for (const cost of modelCosts) {
      costMap[cost.modelName] = cost;
    }
    
    return costMap;
  }

  /**
   * Create a new model cost entry
   */
  async create(modelCost: Omit<ModelCost, 'id'>): Promise<string> {
    try {
      const firestore = this.firestoreService.getFirestore();
      const docRef = await firestore
        .collection(this.collectionName)
        .add({
          ...modelCost,
          updatedAt: new Date(),
        });

      return docRef.id;
    } catch (error) {
      console.error('Error creating model cost:', error);
      throw new Error('Failed to create model cost');
    }
  }

  /**
   * Update an existing model cost entry
   */
  async update(id: string, updates: Partial<ModelCost>): Promise<void> {
    try {
      const firestore = this.firestoreService.getFirestore();
      await firestore
        .collection(this.collectionName)
        .doc(id)
        .update({
          ...updates,
          updatedAt: new Date(),
        });
    } catch (error) {
      console.error(`Error updating model cost ${id}:`, error);
      throw new Error('Failed to update model cost');
    }
  }
}