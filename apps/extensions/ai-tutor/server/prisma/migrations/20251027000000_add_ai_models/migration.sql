-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_modelId_key" ON "AiModel"("modelId");
