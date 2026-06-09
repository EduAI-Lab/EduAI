-- CreateTable
CREATE TABLE "canvas_integrations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canvasUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "isTestMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canvas_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canvas_integrations_userId_key" ON "canvas_integrations"("userId");

-- AddForeignKey
ALTER TABLE "canvas_integrations" ADD CONSTRAINT "canvas_integrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
