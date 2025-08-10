import { VectorStoreService } from "../vector-store.service";
import { VectorStores } from "../types";

export class QuestionService {
  constructor(private vectorStoreService: VectorStoreService) {}

  async getAllQuestions(courseId: number) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Question
    );
    return await repository
      .createQueryBuilder("question")
      .select(["question.id", "question.pageContent", "question.metadata"])
      .where("question.metadata ->> 'courseId' = :courseId", {
        courseId: String(courseId),
      })
      .getMany();
  }

  async addQuestion(
    courseId: number,
    questionText: string,
    answer: string,
    verified: boolean,
    sourceDocuments: any,
    suggested: boolean
  ) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Question
    );
    const questionVector = await this.vectorStoreService.embedQuery(
      questionText
    );
    const embeddingString = `[${questionVector.join(",")}]`;

    const newQuestion = repository.create({
      pageContent: questionText,
      embedding: embeddingString,
      metadata: {
        courseId: String(courseId),
        answer,
        verified,
        sourceDocuments,
        suggested,
        embeddingModel: this.vectorStoreService.embeddingModelName,
        inserted: true,
      },
    } as any);
    return await repository.save(newQuestion);
  }

  async updateQuestion(
    id: string,
    questionText: string,
    answer?: string,
    verified?: boolean,
    sourceDocuments?: any,
    suggested?: boolean,
    inserted?: boolean
  ) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Question
    );
    const entry = await repository
      .createQueryBuilder("question")
      .where("question.id = :id", { id })
      .getOne();

    if (!entry) {
      throw new Error("Question not found");
    }

    if (questionText) {
      (entry as any).pageContent = questionText;
      const questionVector = await this.vectorStoreService.embedQuery(
        questionText
      );
      (entry as any).embedding = `[${questionVector.join(",")}]`;
    }

    (entry as any).metadata = {
      ...(entry as any).metadata,
      answer: typeof answer !== "undefined" ? answer : (entry as any).metadata.answer,
      verified:
        typeof verified !== "undefined" ? verified : (entry as any).metadata.verified,
      suggested:
        typeof suggested !== "undefined" ? suggested : (entry as any).metadata.suggested,
      inserted:
        typeof inserted !== "undefined" ? inserted : (entry as any).metadata.inserted,
      sourceDocuments: sourceDocuments || (entry as any).metadata.sourceDocuments,
      embeddingModel: this.vectorStoreService.embeddingModelName,
    } as any;

    return await repository.save(entry);
  }

  async deleteQuestion(id: string) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Question
    );
    const entry = await repository
      .createQueryBuilder("question")
      .where("question.id = :id", { id })
      .getOne();
    if (!entry) {
      throw new Error("Question not found");
    }
    return await repository.remove(entry);
  }

  async deleteAllQuestions(courseId: number) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Question
    );
    await repository
      .createQueryBuilder("question")
      .delete()
      .where("question.metadata ->> 'courseId' = :courseId", {
        courseId: String(courseId),
      })
      .execute();
  }

  async getSuggestedQuestions(courseId: number) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.Question
    );
    return await repository
      .createQueryBuilder("question")
      .select(["question.metadata", "question.pageContent", "question.id"])
      .where("CAST(question.metadata ->> 'suggested' AS BOOLEAN) = true")
      .andWhere("question.metadata ->> 'courseId' = :courseId", {
        courseId: String(courseId),
      })
      .getMany();
  }
}


