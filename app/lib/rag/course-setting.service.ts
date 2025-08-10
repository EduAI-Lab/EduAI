import { Cache } from "cache-manager";
import { defaultChatbotSetting, UpdateChatbotSettingParams, VectorStores } from "./types";
import { VectorStoreService } from "./vector-store.service";

export class CourseSettingService {
  constructor(
    private vectorStoreService: VectorStoreService,
    private cacheManager?: Cache
  ) {}

  async getChatbotSetting(courseId: number) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.CourseSettings
    );
    let setting = await repository
      .createQueryBuilder("course_setting")
      .select([
        "course_setting.id",
        "course_setting.pageContent",
        "course_setting.metadata",
      ])
      .where('"course_setting"."pageContent" = :id', { id: String(courseId) })
      .getOne();
    if (!setting) {
      setting = await repository.save({
        pageContent: String(courseId),
        metadata: defaultChatbotSetting,
      } as any);
    }
    return setting;
  }

  async getAllChatbotSettings() {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.CourseSettings
    );
    return await repository
      .createQueryBuilder("course_setting")
      .select([
        "course_setting.id",
        "course_setting.pageContent",
        "course_setting.metadata",
      ])
      .getMany();
  }

  async resetToDefault(courseId: number) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.CourseSettings
    );
    return await repository
      .createQueryBuilder("course_setting")
      .update()
      .set({ metadata: defaultChatbotSetting } as any)
      .where('"course_setting"."pageContent" = :id', { id: String(courseId) })
      .execute();
  }

  async updateChatbotSetting(courseId: number, params: UpdateChatbotSettingParams) {
    const repository = await this.vectorStoreService.getRepository(
      VectorStores.CourseSettings
    );
    const entry = await repository
      .createQueryBuilder("course_setting")
      .where("course_setting.pageContent = :id", { id: String(courseId) })
      .getOne();
    if (!entry) {
      throw new Error("CourseSetting not found");
    }
    (entry as any).metadata = {
      ...(entry as any).metadata,
      ...(params.prompt !== undefined && { prompt: params.prompt }),
      ...(params.modelName !== undefined && { modelName: params.modelName }),
      ...(params.temperature !== undefined && { temperature: params.temperature }),
      ...(params.topK !== undefined && { topK: params.topK }),
      ...(params.similarityThresholdDocuments !== undefined && {
        similarityThresholdDocuments: params.similarityThresholdDocuments,
      }),
    } as any;
    if (this.cacheManager) {
      await this.cacheManager.del?.(`course-service-${courseId}`);
    }
    return await repository.save(entry);
  }
}


