import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthModule } from './health/health.module';
import { ConfigModule } from '@nestjs/config';
import { ConsultationsModule } from "./consultations/consultations.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    HealthModule,
    ConsultationsModule,
  ],
  
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
